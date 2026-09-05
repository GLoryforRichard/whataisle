import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ThinkingLevel } from '@google/genai';
import {
  DEFAULT_GEMINI_MODEL,
  lowestSupportedThinkingLevel,
  temperatureConfigForModel,
  vertexGlobalTokenPrice,
} from '../lib/gemini-model.mjs';

const readRepoFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Gemini 3.7 uses LOW while older overrides keep MINIMAL', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.7-flash');
  assert.equal(lowestSupportedThinkingLevel(DEFAULT_GEMINI_MODEL), ThinkingLevel.LOW);
  assert.equal(lowestSupportedThinkingLevel('models/gemini-3.7-flash'), ThinkingLevel.LOW);
  assert.equal(
    lowestSupportedThinkingLevel(
      'projects/example/locations/global/publishers/google/models/gemini-3.7-flash',
    ),
    ThinkingLevel.LOW,
  );
  assert.equal(lowestSupportedThinkingLevel('gemini-3.6-flash'), ThinkingLevel.MINIMAL);
  assert.equal(lowestSupportedThinkingLevel('gemini-3.5-flash'), ThinkingLevel.MINIMAL);
});

test('Gemini 3.7 drops temperature without changing older model overrides', () => {
  assert.deepEqual(temperatureConfigForModel(DEFAULT_GEMINI_MODEL, 0.2), {});
  assert.deepEqual(
    temperatureConfigForModel('publishers/google/models/gemini-3.7-flash', 0.2),
    {},
  );
  assert.deepEqual(temperatureConfigForModel('gemini-3.6-flash', 0.2), { temperature: 0.2 });
});

test('Vertex pricing follows the 3.7 introductory-price boundary', () => {
  const duringIntro = Date.UTC(2026, 8, 2);
  const afterIntro = Date.UTC(2027, 0, 1);

  assert.deepEqual(vertexGlobalTokenPrice('gemini-3.7-flash', duringIntro), {
    inPerM: 0.75,
    outPerM: 3.75,
  });
  assert.deepEqual(vertexGlobalTokenPrice('gemini-3.6-flash', duringIntro), {
    inPerM: 0.75,
    outPerM: 3.75,
  });
  assert.deepEqual(vertexGlobalTokenPrice('gemini-3.7-flash', afterIntro), {
    inPerM: 1.5,
    outPerM: 7.5,
  });
  assert.deepEqual(
    vertexGlobalTokenPrice('publishers/google/models/gemini-3.7-flash', duringIntro),
    { inPerM: 0.75, outPerM: 3.75 },
  );
  assert.equal(vertexGlobalTokenPrice('unknown-model', duringIntro), null);
});

test('all first-party Vertex defaults and the 3.7 scan price stay pinned', async () => {
  const [gemini, intake, aliases, compare, pricing, cost, smokeGemini, smokeFlex] = await Promise.all([
    readRepoFile('lib/gemini.ts'),
    readRepoFile('lib/scan/intake.ts'),
    readRepoFile('lib/agents/tools-a.ts'),
    readRepoFile('lib/compare/types.ts'),
    readRepoFile('lib/scan/pricing.ts'),
    readRepoFile('lib/cost.ts'),
    readRepoFile('scripts/smoke-gemini.mjs'),
    readRepoFile('scripts/smoke-flex.mjs'),
  ]);

  for (const source of [gemini, intake, aliases, compare, smokeGemini, smokeFlex]) {
    assert.match(source, /DEFAULT_GEMINI_MODEL/);
  }
  assert.match(pricing, /vertexGlobalTokenPrice\(modelId\)/);
  assert.match(cost, /candidatesTokenCount[^;]+thoughtsTokenCount/s);
});

test('legacy function responses preserve the Gemini call id', async () => {
  const agentA = await readRepoFile('lib/agents/agent-a.ts');
  assert.match(agentA, /functionResponse:\s*\{\s*id: call\.id,/s);
});

test('MINIMAL is isolated to the compatibility helper', async () => {
  const callSites = await Promise.all([
    'lib/gemini.ts',
    'lib/agents/adk/search-agent.ts',
    'lib/agents/tools-b.ts',
    'lib/scan/transport.ts',
  ].map(readRepoFile));

  for (const source of callSites) {
    assert.doesNotMatch(source, /ThinkingLevel\.MINIMAL/);
  }
});

test('third-party and intentional Cost Lab baselines remain on 3.6', async () => {
  const [compare, schemes] = await Promise.all([
    readRepoFile('lib/compare/types.ts'),
    readRepoFile('lib/costlab/schemes.ts'),
  ]);

  assert.match(compare, /OPENROUTER_COMPARE_MODEL = 'google\/gemini-3\.6-flash'/);
  assert.match(schemes, /const G36 = 'google\/gemini-3\.6-flash'/);
  assert.match(schemes, /modelId: 'gemini-3\.6-flash', transport: 'vertex'/);
});
