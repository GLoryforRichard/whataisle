import 'server-only';

/**
 * Qwen (DashScope International) transport + resilience wrappers.
 *
 * Every AI call in the app goes through this module, all via the
 * OpenAI-compatible surface (`/compatible-mode/v1/...`):
 * - chatWithRetry / chatWithHedge — text + vision chat completions
 * - embedTexts                    — text-embedding-v4 (batch cap 10)
 * - transcribeWithAsr             — qwen3-asr-flash audio transcription
 *
 * DASHSCOPE_API_KEY absent (or AI_STUB=true) → stub mode
 * (isAiConfigured() === false): the pipeline runs with deterministic fake
 * recognition so the scan/search plumbing is testable offline. See stub.ts.
 */

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com';

function baseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ''
  );
}

export function isAiConfigured(): boolean {
  // AI_STUB=true forces deterministic stub recognition even when credentials
  // are present — used for offline local dev and CI (no quota burn).
  if (process.env.AI_STUB === 'true') return false;
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

// ---------------------------------------------------------------------------
// Concurrency gate — cap in-flight DashScope calls process-wide so a burst of
// parallel photo processing doesn't trip account rate limits. Chat, embeddings
// and ASR all share the one gate.
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

// ---------------------------------------------------------------------------
// POST with retry on transient 429/5xx (backoff 1s→2s→4s→8s + jitter, max 5
// attempts) behind the concurrency gate.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;

/** Raw provider JSON — parsed defensively at each call site. */
type ProviderJson = any;

async function postWithRetry(
  path: string,
  body: unknown
): Promise<ProviderJson> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!isAiConfigured() || !key) {
    throw new Error('AI is not configured: set DASHSCOPE_API_KEY');
  }
  const url = `${baseUrl()}${path}`;
  const payload = JSON.stringify(body);
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = 2 ** (attempt - 1) * 1000 + Math.random() * 500;
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      console.warn(
        `[ai] transient error, attempt ${attempt + 1}/${MAX_ATTEMPTS}, retry in ${Math.round(delay)}ms — ${msg.slice(0, 120)}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
    await acquire();
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      if (resp.ok) return await resp.json();
      const bodyText = await resp.text().catch(() => '');
      const retryable =
        resp.status === 429 ||
        resp.status >= 500 ||
        /throttling/i.test(bodyText);
      const err = new Error(
        `DashScope ${resp.status}: ${bodyText.slice(0, 300)}`
      );
      if (!retryable) throw err;
      lastErr = err;
    } catch (err) {
      // undici surfaces network-level failures as TypeError — retryable.
      if (err instanceof TypeError) {
        lastErr = err;
      } else {
        throw err;
      }
    } finally {
      release();
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Chat (text + vision)
// ---------------------------------------------------------------------------

export type ChatPart =
  | { text: string }
  | { image: { base64: string; mimeType: string } };

export interface ChatParams {
  model: string;
  /** One user message; parts are sent in order. */
  parts: ChatPart[];
  system?: string;
  /** true → response_format json_object (still fence-stripped defensively). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** false → enable_thinking:false (all current callers want no thinking). */
  thinking?: boolean;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
}

/**
 * Strip a ``` fence wrapper if the model ignored response_format and fenced
 * its output anyway (seen on VL models).
 */
function stripJsonFences(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1].trim() : t;
}

function toContent(parts: ChatPart[]): Array<Record<string, unknown>> {
  return parts.map((p) =>
    'text' in p
      ? { type: 'text', text: p.text }
      : {
          type: 'image_url',
          image_url: {
            url: `data:${p.image.mimeType};base64,${p.image.base64}`,
          },
        }
  );
}

export async function chatWithRetry(params: ChatParams): Promise<ChatResult> {
  const messages: Array<Record<string, unknown>> = [];
  if (params.system) {
    messages.push({ role: 'system', content: params.system });
  }
  messages.push({ role: 'user', content: toContent(params.parts) });

  const body: Record<string, unknown> = { model: params.model, messages };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.json) body.response_format = { type: 'json_object' };
  if (params.thinking === false) body.enable_thinking = false;

  const data = await postWithRetry(
    '/compatible-mode/v1/chat/completions',
    body
  );
  const raw = data?.choices?.[0]?.message?.content;
  return {
    text: typeof raw === 'string' ? stripJsonFences(raw) : '',
    usage: {
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Tail-latency hedge for small latency-sensitive calls (voice/photo): if the
 * first attempt hasn't answered within hedgeAfterMs, fire a duplicate and take
 * whichever lands first.
 */
export async function chatWithHedge(
  params: ChatParams,
  hedgeAfterMs = 6000
): Promise<ChatResult> {
  const first = chatWithRetry(params);
  const timedOut = Symbol('hedge');
  const raced = await Promise.race([
    first,
    new Promise<typeof timedOut>((r) =>
      setTimeout(() => r(timedOut), hedgeAfterMs)
    ),
  ]);
  if (raced !== timedOut) return raced as ChatResult;
  const second = chatWithRetry(params);
  first.catch(() => {});
  second.catch(() => {});
  return Promise.race([first, second]);
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** text-embedding-v4 caps input at 10 texts per request. */
const EMBED_BATCH_MAX = 10;

/**
 * Embed texts, chunking into ≤10-item requests (concurrency still capped by
 * the shared gate). A missing row comes back as [] so callers can detect the
 * dimension mismatch and fall back.
 */
export async function embedTexts(
  model: string,
  texts: string[],
  dimensions: number
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_MAX) {
    batches.push(texts.slice(i, i + EMBED_BATCH_MAX));
  }
  const results = await Promise.all(
    batches.map(async (batch) => {
      const data = await postWithRetry('/compatible-mode/v1/embeddings', {
        model,
        input: batch,
        dimensions,
        encoding_format: 'float',
      });
      const out: number[][] = batch.map(() => []);
      const rows: Array<{ index?: number; embedding?: number[] }> =
        Array.isArray(data?.data) ? data.data : [];
      for (const row of rows) {
        if (
          typeof row?.index === 'number' &&
          row.index >= 0 &&
          row.index < batch.length &&
          Array.isArray(row.embedding)
        ) {
          out[row.index] = row.embedding;
        }
      }
      return out;
    })
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// ASR (qwen3-asr-flash — the one ASR series exposed on the compatible surface)
// ---------------------------------------------------------------------------

export interface AsrParams {
  model: string;
  audioBase64: string;
  mimeType: string;
  /** Domain context to bias transcription (product names, brands, store info). */
  biasText?: string;
}

export async function transcribeWithAsr(
  params: AsrParams
): Promise<{ text: string; usage: ChatUsage }> {
  const format = params.mimeType.split('/')[1]?.split(';')[0] || 'webm';
  const messages: Array<Record<string, unknown>> = [];
  if (params.biasText) {
    // The ASR task rejects plain-string system content (400
    // InvalidParameter) — it must be an array of text parts.
    messages.push({
      role: 'system',
      content: [{ type: 'text', text: params.biasText }],
    });
  }
  messages.push({
    role: 'user',
    content: [
      {
        type: 'input_audio',
        input_audio: {
          data: `data:${params.mimeType};base64,${params.audioBase64}`,
          format,
        },
      },
    ],
  });

  const data = await postWithRetry('/compatible-mode/v1/chat/completions', {
    model: params.model,
    messages,
    // Auto language detection; no inverse text normalization (search phrases).
    asr_options: { enable_lid: true, enable_itn: false },
  });
  const raw = data?.choices?.[0]?.message?.content;
  // ASR bills per audio second, not per token. By convention (see usage.ts)
  // the ASR usage row carries audio seconds in inputTokens when reported.
  const seconds = Number(data?.usage?.seconds ?? 0);
  return {
    text: typeof raw === 'string' ? raw.trim() : '',
    usage: {
      inputTokens: seconds > 0 ? seconds : (data?.usage?.prompt_tokens ?? 0),
      outputTokens: data?.usage?.completion_tokens ?? 0,
    },
  };
}
