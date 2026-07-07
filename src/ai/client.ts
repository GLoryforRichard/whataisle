import 'server-only';

import { GoogleGenAI } from '@google/genai';

/**
 * Gemini provider selection + resilience wrappers.
 *
 * Ported from the proven wherebear pipeline (lib/gemini.ts):
 * - GEMINI_API_KEY present  → AI Studio (free tier, no Cloud billing) — local dev
 * - else GOOGLE_CLOUD_PROJECT → Vertex AI via ADC — production on GCP
 * - neither → stub mode (isAiConfigured() === false): the pipeline runs with
 *   deterministic fake recognition so the scan/search plumbing is testable
 *   offline. See src/ai/stub.ts.
 */

const apiKey = process.env.GEMINI_API_KEY;
const project = process.env.GOOGLE_CLOUD_PROJECT;
// Gemini 3.x is served only from the "global" Vertex location as of 2026.
const location = 'global';

export function isAiConfigured(): boolean {
  // AI_STUB=true forces deterministic stub recognition even when credentials
  // are present — used for offline local dev and CI (no quota burn).
  if (process.env.AI_STUB === 'true') return false;
  return Boolean(apiKey || project);
}

let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!isAiConfigured()) {
    throw new Error(
      'AI is not configured: set GEMINI_API_KEY (AI Studio) or GOOGLE_CLOUD_PROJECT (Vertex ADC)'
    );
  }
  if (!client) {
    client = apiKey
      ? new GoogleGenAI({ apiKey })
      : new GoogleGenAI({ vertexai: true, project, location });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Concurrency gate — cap in-flight Gemini calls process-wide so a burst of
// parallel photo processing doesn't trip free-tier/DSQ rate limits.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = Number(process.env.AI_MAX_CONCURRENT ?? 4);
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  while (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((r) => waiters.push(r));
  }
  inFlight++;
}

function release(): void {
  inFlight--;
  waiters.shift()?.();
}

type GenParams = Parameters<GoogleGenAI['models']['generateContent']>[0];
type GenResult = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

/**
 * generateContent with retry on transient 429/5xx (backoff 1s→2s→4s→8s + jitter,
 * max 5 attempts) behind the concurrency gate.
 */
export async function generateContentWithRetry(
  params: GenParams
): Promise<GenResult> {
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  const genai = getGenAI();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await acquire();
      try {
        return await genai.models.generateContent(params);
      } finally {
        release();
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        (err as { status?: number })?.status ??
        (err as { code?: number })?.code;
      const is429 =
        status === 429 ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.toLowerCase().includes('quota');
      const is5xx =
        status === 500 ||
        status === 503 ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('INTERNAL');
      if (!is429 && !is5xx) throw err;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
      const delay = 2 ** attempt * 1000 + Math.random() * 500;
      console.warn(
        `[ai] ${is429 ? '429' : '5xx'} attempt ${attempt + 1}/${MAX_ATTEMPTS}, retry in ${Math.round(delay)}ms — ${msg.slice(0, 120)}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Tail-latency hedge for small latency-sensitive calls (voice/photo): if the
 * first attempt hasn't answered within hedgeAfterMs, fire a duplicate and take
 * whichever lands first.
 */
export async function generateContentWithHedge(
  params: GenParams,
  hedgeAfterMs = 6000
): Promise<GenResult> {
  const first = generateContentWithRetry(params);
  const timedOut = Symbol('hedge');
  const raced = await Promise.race([
    first,
    new Promise<typeof timedOut>((r) =>
      setTimeout(() => r(timedOut), hedgeAfterMs)
    ),
  ]);
  if (raced !== timedOut) return raced as GenResult;
  const second = generateContentWithRetry(params);
  first.catch(() => {});
  second.catch(() => {});
  return Promise.race([first, second]);
}
