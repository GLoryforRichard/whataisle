import 'server-only';

/**
 * Content-safety pre-filter for the public shopper endpoint (requirements §10).
 *
 * Every store's shopper page is a public, login-free AI endpoint; people will
 * try to break it. Off-topic chatter, prompt-injection attempts, and abuse get
 * a polite "I can only help you find products", are never acted on, and are
 * excluded from top-search statistics. There is no catalog-enumeration path,
 * and rate limiting backs this up (see the search route).
 *
 * This is a deterministic heuristic gate that runs before any AI call, so it
 * works even in degraded/stub mode.
 */

const MAX_QUERY_LENGTH = 120;

const INJECTION_PATTERNS = [
  /ignore (all |the |your )?(previous|prior|above) (instructions|prompt)/i,
  /system prompt/i,
  /you are (now |an? )?(ai|assistant|chatbot|dan|jailbroken)/i,
  /(pretend|act) (to be|as)/i,
  /disregard/i,
  /reveal (your|the) (prompt|instructions|system)/i,
  /\bprompt\s*injection\b/i,
  /repeat (everything|the words|after me)/i,
];

const ENUMERATION_PATTERNS = [
  /list (all|every|the entire|your whole)/i,
  /(all|every|entire|whole|complete) (products?|items?|catalog|inventory|sku)/i,
  /(列出|所有|全部|清单).*(商品|产品|货)/,
  /dump (the|all|your)/i,
];

const URL_PATTERN = /https?:\/\/|www\.|\b\S+\.(com|net|org|io|cn)\b/i;

export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_long' | 'injection' | 'enumeration' | 'url' | 'empty';
    };

export function checkQuery(raw: string): GuardResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_QUERY_LENGTH) return { ok: false, reason: 'too_long' };
  if (INJECTION_PATTERNS.some((re) => re.test(text)))
    return { ok: false, reason: 'injection' };
  if (ENUMERATION_PATTERNS.some((re) => re.test(text)))
    return { ok: false, reason: 'enumeration' };
  if (URL_PATTERN.test(text)) return { ok: false, reason: 'url' };
  return { ok: true };
}
