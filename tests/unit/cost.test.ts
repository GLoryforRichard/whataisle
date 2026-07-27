import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sumCost } from '../../src/ai/scan/cost';

test('sumCost: null and zero stay distinguishable', () => {
  // The whole reason ai_usage_log.cost_usd is nullable. The tempting
  // one-liner `reduce((a, o) => a + (o.costUsd ?? 0), 0)` passes every other
  // case here and fails these two — it reports $0.00 for a store nobody
  // ever billed, which is the blind spot the column exists to remove.
  assert.equal(sumCost([]), null, 'no outcomes → unmetered, not $0');
  assert.equal(
    sumCost([{ costUsd: null }, { costUsd: null }]),
    null,
    'all outcomes unmetered → unmetered'
  );
  assert.equal(
    sumCost([{ costUsd: 0 }]),
    0,
    'a genuine $0 call is metered, not unknown'
  );
});

test('sumCost: sums the metered outcomes, skipping the rest', () => {
  assert.equal(sumCost([{ costUsd: 0.0042 }]), 0.0042);

  // Mixed: failed calls report null, billed ones report a number. Float
  // addition makes this 0.0030000000000000005, so compare with a tolerance.
  const mixed = sumCost([
    { costUsd: null },
    { costUsd: 0.001 },
    { costUsd: null },
    { costUsd: 0.002 },
  ]);
  assert.ok(mixed !== null, 'one metered outcome is enough to report a cost');
  assert.ok(Math.abs(mixed - 0.003) < 1e-9, `expected ~0.003, got ${mixed}`);
});

test('sumCost: keeps sub-microdollar calls (numeric scale 8 stores them)', () => {
  // A real gemini-3.5-flash-lite call billed $0.0000028; scale 6 would have
  // rounded it away, so the column is numeric(14,8) and this must not be 0.
  const tiny = sumCost([{ costUsd: 2.8e-6 }, { costUsd: 2.8e-6 }]);
  assert.ok(tiny !== null && tiny > 5e-6, `expected ~5.6e-6, got ${tiny}`);
});
