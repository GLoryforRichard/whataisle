import 'server-only';

import pLimit from 'p-limit';
import { OPENROUTER_MAX_CONCURRENT } from './config';

const OR_BASE = 'https://openrouter.ai/api/v1';

/**
 * Global governor: every OpenRouter call in the process (row detect, band
 * detect, grid readout, try-out precheck) shares one concurrency pool so
 * concurrent scans can't stampede the provider.
 */
const globalLimit = pLimit(OPENROUTER_MAX_CONCURRENT);

/**
 * Transient rate-limit/overload errors are worth waiting out; a hard key
 * spending cap is not.
 */
function isTransientLimit(error: string | null): boolean {
  if (!error) return false;
  if (/key limit/i.test(error)) return false;
  return /HTTP 429|rate.?limit|overloaded|HTTP 503|HTTP 502/i.test(error);
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  return key;
}

export interface CallOutcome {
  ok: boolean;
  rawText: string | null;
  latencyMs: number;
  costUsd: number | null;
  tokens: { prompt: number; completion: number; reasoning: number } | null;
  generationId: string | null;
  error: string | null;
}

export interface CallModelOptions {
  modelId: string;
  imageJpeg: Buffer;
  prompt: string;
  schema?: object;
  schemaName?: string;
  timeoutMs?: number;
  /**
   * OpenRouter unified reasoning control; 'low' cuts thinking-token latency,
   * 'off' asks for the smallest thinking budget the provider accepts (some,
   * like Gemini 3.5, mandate reasoning and can't hard-disable it).
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'off';
}

/**
 * Transient network failures (socket resets, DNS hiccups under concurrent
 * bursts) surface as a thrown fetch — retry those once before giving up.
 * Transient 429/502/503 get exponential backoff on top.
 */
export async function callModel(opts: CallModelOptions): Promise<CallOutcome> {
  return globalLimit(async () => {
    let outcome = await callModelOnce(opts);
    if (!outcome.ok && outcome.error?.startsWith('network:')) {
      await new Promise((r) => setTimeout(r, 1000));
      outcome = await callModelOnce(opts);
    }
    for (const delayMs of [1000, 4000, 16000]) {
      if (outcome.ok || !isTransientLimit(outcome.error)) break;
      await new Promise((r) => setTimeout(r, delayMs));
      outcome = await callModelOnce(opts);
    }
    return outcome;
  });
}

async function callModelOnce(opts: CallModelOptions): Promise<CallOutcome> {
  const {
    modelId,
    imageJpeg,
    prompt,
    schema,
    schemaName = 'scan_result',
    timeoutMs = 240_000,
    reasoningEffort,
  } = opts;
  const content = [
    { type: 'text', text: prompt },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${imageJpeg.toString('base64')}`,
      },
    },
  ];
  const payload: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'user', content }],
    max_tokens: 16000,
    temperature: 0,
  };
  if (reasoningEffort === 'off') payload.reasoning = { max_tokens: 128 };
  else if (reasoningEffort) payload.reasoning = { effort: reasoningEffort };
  if (schema) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        'X-Title': 'whataisle',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // fetch resolves on headers; generation streams in with the body.
    // Wall-clock latency must include the full body read.
    const bodyText = await res.text();
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) {
      return {
        ok: false,
        rawText: null,
        latencyMs,
        costUsd: null,
        tokens: null,
        generationId: null,
        error: `HTTP ${res.status}: ${bodyText.slice(0, 500)}`,
      };
    }
    const body = JSON.parse(bodyText) as {
      id?: string;
      choices?: {
        message?: { content?: string };
        error?: { message?: string };
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      error?: { message?: string };
    };
    if (body.error?.message) {
      return {
        ok: false,
        rawText: null,
        latencyMs,
        costUsd: null,
        tokens: null,
        generationId: body.id ?? null,
        error: body.error.message,
      };
    }
    const text = body.choices?.[0]?.message?.content ?? '';
    const usage = body.usage;
    const tokens = usage
      ? {
          prompt: usage.prompt_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
          reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        }
      : null;
    // HTTP 200 with an empty completion happens when a reasoning model burns
    // its whole token budget thinking (billed, zero output). Treat as failure
    // so callers' retry paths engage; keep cost/tokens for honest accounting.
    if (!text.trim()) {
      return {
        ok: false,
        rawText: null,
        latencyMs,
        costUsd: usage?.cost ?? null,
        tokens,
        generationId: body.id ?? null,
        error: 'empty completion (model produced no output)',
      };
    }
    return {
      ok: true,
      rawText: text,
      latencyMs,
      costUsd: usage?.cost ?? null,
      tokens,
      generationId: body.id ?? null,
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    let msg: string;
    if (err instanceof Error && err.name === 'AbortError') {
      msg = `timeout after ${timeoutMs / 1000}s`;
    } else if (err instanceof Error) {
      // undici hides the real reason (ECONNRESET etc.) in err.cause
      const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
      msg = `network: ${err.message}${cause}`;
    } else {
      msg = `network: ${String(err)}`;
    }
    return {
      ok: false,
      rawText: null,
      latencyMs,
      costUsd: null,
      tokens: null,
      generationId: null,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Sum token usage across a set of call outcomes (for ai_usage_log rows). */
export function sumTokens(outcomes: CallOutcome[]): {
  prompt: number;
  completion: number;
  reasoning: number;
} {
  const t = { prompt: 0, completion: 0, reasoning: 0 };
  for (const o of outcomes) {
    t.prompt += o.tokens?.prompt ?? 0;
    t.completion += o.tokens?.completion ?? 0;
    t.reasoning += o.tokens?.reasoning ?? 0;
  }
  return t;
}
