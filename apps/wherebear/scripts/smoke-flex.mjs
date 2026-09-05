/**
 * Smoke test: confirm the Vertex FLEX service tier accepts our header and
 * measure its latency vs the standard tier.
 *   node --env-file=.env.local scripts/smoke-flex.mjs
 * Mirrors lib/gemini.ts config (vertexai, project, location='global') and
 * lib/scan/transport-flex.ts mechanics (header + httpOptions.timeout).
 *
 * Flex acceptance is verified from usageMetadata.trafficType; billing should
 * still be reconciled in the GCP console the next day.
 */
import { GoogleGenAI } from '@google/genai';
import {
  DEFAULT_GEMINI_MODEL,
  lowestSupportedThinkingLevel,
} from '../lib/gemini-model.mjs';

const apiKey = process.env.GEMINI_API_KEY;
const project = process.env.GOOGLE_CLOUD_PROJECT;
const model = process.env.GEMINI_SCAN_MODEL || DEFAULT_GEMINI_MODEL;
if (apiKey) {
  console.error('Flex smoke requires Vertex ADC; unset GEMINI_API_KEY.');
  process.exit(1);
}
if (!project) {
  console.error('Flex smoke requires GOOGLE_CLOUD_PROJECT.');
  process.exit(1);
}
console.log(`auth: Vertex ADC | project: ${project} | model: ${model}`);

const genai = new GoogleGenAI({ vertexai: true, project, location: 'global' });

async function call(tier) {
  const config = {
    maxOutputTokens: 2000,
    thinkingConfig: { thinkingLevel: lowestSupportedThinkingLevel(model) },
  };
  if (tier === 'flex') {
    config.httpOptions = {
      headers: { 'X-Vertex-AI-LLM-Shared-Request-Type': 'flex' },
      timeout: 900_000,
    };
  }
  const t0 = Date.now();
  const r = await genai.models.generateContent({
    model,
    contents: 'Reply with exactly: ok',
    config,
  });
  if ((r.text ?? '').trim().toLowerCase() !== 'ok') {
    throw new Error(`unexpected Gemini response: ${JSON.stringify(r.text)}`);
  }
  const trafficType = r.usageMetadata?.trafficType ?? 'STANDARD';
  if (tier === 'flex' && trafficType !== 'ON_DEMAND_FLEX') {
    throw new Error(`Flex header was not honored (trafficType=${trafficType})`);
  }
  const ms = Date.now() - t0;
  console.log(
    `✓ ${tier.padEnd(8)} ${String(ms).padStart(6)}ms | traffic ${trafficType} | responseId ${r.responseId ?? '(none)'} | text ${JSON.stringify(r.text)} | tokens in/out/think ${r.usageMetadata?.promptTokenCount}/${r.usageMetadata?.candidatesTokenCount}/${r.usageMetadata?.thoughtsTokenCount ?? 0}`
  );
}

try {
  await call('standard');
  await call('flex');
  console.log('Flex traffic type confirmed. Verify billed Flex SKUs tomorrow.');
} catch (e) {
  console.error('✗ call failed:', e?.message ?? e);
  process.exitCode = 1;
}
