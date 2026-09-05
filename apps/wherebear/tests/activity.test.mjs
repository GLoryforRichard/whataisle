import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeActivity } from '../lib/activity.mjs';

test('maps current search_history and legacy search_logs schemas', () => {
  const items = mergeActivity(
    [],
    [{
      _id: 'current-1',
      query: 'jasmine rice',
      found: true,
      product: 'Royal Jasmine Rice',
      ts: new Date('2026-09-02T13:40:00.000Z'),
    }],
    [{
      _id: 'legacy-1',
      query: 'oat milk',
      resolved_intent: 'oat milk',
      results_found: 0,
      timestamp: { $date: '2026-09-02T13:39:00.000Z' },
    }],
  );

  assert.deepEqual(items, [
    {
      type: 'find',
      title: 'Found "jasmine rice"',
      subtitle: 'Royal Jasmine Rice',
      timestamp: '2026-09-02T13:40:00.000Z',
    },
    {
      type: 'find',
      title: 'No result for "oat milk"',
      subtitle: 'oat milk',
      timestamp: '2026-09-02T13:39:00.000Z',
    },
  ]);
});

test('sorts and prefers current history over a near-time legacy duplicate', () => {
  const input = [
    [{
      _id: 'snap-1',
      aisle: 'A11',
      products_detected: ['Rice', 'Beans'],
      timestamp: '2026-09-02T13:41:00.000Z',
    }],
    [{
      _id: 'current-1',
      query: 'Jasmine   Rice',
      found: true,
      product: 'Royal Jasmine Rice',
      ts: '2026-09-02T13:40:00.000Z',
    }],
    [
      {
        _id: 'legacy-duplicate',
        query: 'jasmine rice',
        resolved_intent: 'rice',
        results_found: 1,
        timestamp: '2026-09-02T13:39:55.000Z',
      },
      {
        _id: 'legacy-real-repeat',
        query: 'jasmine rice',
        resolved_intent: 'rice',
        results_found: 1,
        timestamp: '2026-09-02T13:37:00.000Z',
      },
    ],
  ];
  const items = mergeActivity(...input);

  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Snapped A11');
  assert.equal(items[1].title, 'Found "Jasmine   Rice"');
  assert.equal(items[1].subtitle, 'Royal Jasmine Rice');
  assert.equal(items[2].timestamp, '2026-09-02T13:37:00.000Z');
  assert.equal(items[2].subtitle, 'rice');
  assert.deepEqual(mergeActivity(...input, 2), items.slice(0, 2));
});

test('ignores malformed timestamps instead of failing the activity response', () => {
  const items = mergeActivity(
    [{ aisle: 'bad', timestamp: 'not-a-date' }],
    [{ query: 'bad current', found: false, ts: null }],
    [{ query: 'bad legacy', results_found: 0, timestamp: {} }],
  );

  assert.deepEqual(items, []);
});
