import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBoxes } from '../../src/ai/scan/box-parser';

const W = 1536;
const H = 2048;

test('Gemini format: box_2d [ymin,xmin,ymax,xmax] 0-1000', () => {
  const raw = JSON.stringify({
    boxes: [{ label: 'Coke can', box_2d: [100, 200, 300, 400] }],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.coordOrderUsed, 'yx');
  assert.equal(r.scaleDetected, '0-1000');
  assert.deepEqual(r.boxes[0], {
    label: 'Coke can',
    x: 0.2,
    y: 0.1,
    w: 0.2,
    h: 0.2,
  });
});

test('Qwen format: bbox_2d [x1,y1,x2,y2] 0-1000 (x-first)', () => {
  const raw = JSON.stringify([
    { label: 'Milk carton', bbox_2d: [200, 100, 400, 300] },
  ]);
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.coordOrderUsed, 'xy');
  // x1=200,y1=100,x2=400,y2=300 → same normalized box as the Gemini case
  assert.deepEqual(r.boxes[0], {
    label: 'Milk carton',
    x: 0.2,
    y: 0.1,
    w: 0.2,
    h: 0.2,
  });
});

test('absolute pixel coords are rescaled by image dims', () => {
  const raw = JSON.stringify({
    boxes: [{ label: 'Cereal', box_2d: [0, 0, H, W] }], // full image, yx order
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.scaleDetected, 'pixels');
  const b = r.boxes[0];
  assert.ok(Math.abs(b.w - 1) < 1e-6 && Math.abs(b.h - 1) < 1e-6);
});

test('0-1 float coords are scaled up', () => {
  const raw = JSON.stringify({
    boxes: [{ label: 'Jam', box_2d: [0.1, 0.2, 0.3, 0.4] }],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.scaleDetected, '0-1');
  assert.ok(Math.abs(r.boxes[0].x - 0.2) < 1e-6);
});

test('chatty preamble + code fence is stripped', () => {
  const raw =
    'Sure! Here are the detected products:\n```json\n{"boxes":[{"label":"Tea","box_2d":[10,10,90,90]}]}\n```\nLet me know if you need more.';
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.boxes.length, 1);
});

test('alternate container/keys: products + bbox + name', () => {
  const raw = JSON.stringify({
    products: [{ name: 'Yogurt', bbox: [100, 200, 300, 400] }],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.coordOrderUsed, 'xy');
  assert.equal(r.boxes[0].label, 'Yogurt');
});

test('object-form coordinates {ymin,xmin,ymax,xmax}', () => {
  const raw = JSON.stringify({
    boxes: [
      { label: 'Rice', box_2d: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 } },
    ],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.deepEqual(r.boxes[0], {
    label: 'Rice',
    x: 0.2,
    y: 0.1,
    w: 0.2,
    h: 0.2,
  });
});

test('inverted min/max gets swapped, zero-area dropped', () => {
  const raw = JSON.stringify({
    boxes: [
      { label: 'Swapped', box_2d: [300, 400, 100, 200] },
      { label: 'Zero', box_2d: [50, 50, 50, 50] },
    ],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.boxes.length, 1);
  assert.deepEqual(r.boxes[0], {
    label: 'Swapped',
    x: 0.2,
    y: 0.1,
    w: 0.2,
    h: 0.2,
  });
  assert.ok(r.warnings.some((w) => w.includes('Zero')));
});

test('garbage input fails cleanly', () => {
  const r = parseBoxes('I cannot see any image.', W, H);
  assert.equal(r.ok, false);
  assert.equal(r.boxes.length, 0);
});

test('empty sibling array does not mask the real products array', () => {
  // Regression: {"shelf_labels": [], "products": [...]} used to short-circuit
  // on the empty array and report ok with zero boxes (silent coverage hole).
  const raw = JSON.stringify({
    shelf_labels: [],
    products: [{ label: 'Coke can', box_2d: [100, 200, 300, 400] }],
  });
  const r = parseBoxes(raw, W, H);
  assert.equal(r.ok, true);
  assert.equal(r.boxes.length, 1);
  assert.equal(r.boxes[0].label, 'Coke can');
});
