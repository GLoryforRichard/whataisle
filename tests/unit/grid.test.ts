import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cropRect, gridLayout, parseGridNames } from '../../src/ai/scan/grid';

test('cropRect: always stays inside the image, even for edge slivers', () => {
  const cases = [
    // sliver hugging the right edge (regression: 8px min used to overflow)
    { b: { label: 'r', x: 0.999, y: 0.5, w: 0.001, h: 0.1 }, W: 4032, H: 3024 },
    // sliver hugging the bottom edge
    { b: { label: 'b', x: 0.5, y: 0.999, w: 0.1, h: 0.001 }, W: 4032, H: 3024 },
    // corner sliver
    {
      b: { label: 'c', x: 0.9995, y: 0.9995, w: 0.0005, h: 0.0005 },
      W: 1280,
      H: 960,
    },
    // degenerate zero-size box at origin
    { b: { label: 'z', x: 0, y: 0, w: 0, h: 0 }, W: 100, H: 100 },
    // ordinary interior box
    { b: { label: 'n', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, W: 2048, H: 1536 },
  ];
  for (const { b, W, H } of cases) {
    const r = cropRect(b, W, H);
    assert.ok(r.left >= 0 && r.top >= 0, `${b.label}: negative origin`);
    assert.ok(r.width >= 1 && r.height >= 1, `${b.label}: empty rect`);
    assert.ok(
      r.left + r.width <= W,
      `${b.label}: overflows right (${r.left}+${r.width}>${W})`
    );
    assert.ok(
      r.top + r.height <= H,
      `${b.label}: overflows bottom (${r.top}+${r.height}>${H})`
    );
  }
});

test('cropRect: interior boxes keep their padded geometry', () => {
  const r = cropRect(
    { label: 'n', x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    1000,
    1000
  );
  // pad = 15% of the box on each side: 0.25-0.075=0.175 → 175
  assert.equal(r.left, 175);
  assert.equal(r.top, 175);
  assert.equal(r.width, 650);
  assert.equal(r.height, 650);
});

test('gridLayout: cells stay inside the canvas and never overlap', () => {
  for (const n of [1, 3, 5, 12]) {
    const { width, height, cells } = gridLayout(n);
    assert.equal(cells.length, n);
    for (const c of cells) {
      assert.ok(c.x >= 0 && c.y >= 0);
      assert.ok(c.x + c.w <= width);
      assert.ok(c.y + c.h <= height);
      assert.ok(c.labelY < c.y, 'label sits above its cell');
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = cells[i];
        const b = cells[j];
        const overlap =
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h;
        assert.ok(!overlap, `cells ${i} and ${j} overlap`);
      }
    }
  }
});

test('parseGridNames: valid array of the exact length', () => {
  const names = parseGridNames('{"names": ["A", "B", "C"]}', 3);
  assert.deepEqual(names, ['A', 'B', 'C']);
});

test('parseGridNames: wrong length → null (triggers retry/fallback)', () => {
  assert.equal(parseGridNames('{"names": ["A", "B"]}', 3), null);
  assert.equal(parseGridNames('{"names": []}', 3), null);
  assert.equal(parseGridNames('not json', 3), null);
});

test('parseGridNames: empty/blank entries become null but keep positions', () => {
  const names = parseGridNames('{"names": ["A", "  ", "C"]}', 3);
  assert.deepEqual(names, ['A', null, 'C']);
});
