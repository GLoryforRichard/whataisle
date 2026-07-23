import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BAND_OVERLAP,
  buildBands,
  mapBandBox,
  mergeBandBoxes,
  mergeSameLabelGroups,
  normalizeDetectedRows,
} from '../../src/ai/scan/bands';
import type { NormalizedBox } from '../../src/ai/scan/types';

test('buildBands: cores tile [0,1] with no gaps, cuts at row midpoints', () => {
  const bands = buildBands([
    { y0: 0.05, y1: 0.3 },
    { y0: 0.35, y1: 0.6 },
    { y0: 0.65, y1: 0.95 },
  ]);
  assert.equal(bands.length, 3);
  assert.equal(bands[0].core0, 0);
  assert.equal(bands[bands.length - 1].core1, 1);
  for (let i = 1; i < bands.length; i++) {
    assert.equal(bands[i].core0, bands[i - 1].core1); // no gaps
  }
  assert.ok(Math.abs(bands[0].core1 - 0.325) < 1e-9); // mid(0.3, 0.35)
  // expanded slices add overlap but stay clamped
  assert.equal(bands[0].y0, 0);
  assert.ok(Math.abs(bands[0].y1 - (0.325 + BAND_OVERLAP)) < 1e-9);
});

test('buildBands: empty/garbage rows degrade to a single full band', () => {
  assert.deepEqual(buildBands([]), [{ core0: 0, core1: 1, y0: 0, y1: 1 }]);
  assert.deepEqual(buildBands([{ y0: 0.5, y1: 0.5 }]), [
    { core0: 0, core1: 1, y0: 0, y1: 1 },
  ]);
});

test('buildBands: caps the band count', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    y0: i * 0.05,
    y1: i * 0.05 + 0.04,
  }));
  const bands = buildBands(rows);
  assert.ok(bands.length <= 8);
  assert.equal(bands[0].core0, 0);
  assert.equal(bands[bands.length - 1].core1, 1);
});

test('mapBandBox converts band-local fractions to full-image fractions', () => {
  const band = { core0: 0.25, core1: 0.5, y0: 0.2, y1: 0.55 };
  const mapped = mapBandBox(
    { label: 'x', x: 0.1, y: 0.5, w: 0.2, h: 0.2 },
    band
  );
  assert.equal(mapped.x, 0.1);
  assert.equal(mapped.w, 0.2);
  assert.ok(Math.abs(mapped.y - (0.2 + 0.5 * 0.35)) < 1e-9);
  assert.ok(Math.abs(mapped.h - 0.2 * 0.35) < 1e-9);
});

test('mergeBandBoxes: overlap-margin duplicates dropped by center ownership', () => {
  const bands = buildBands([
    { y0: 0, y1: 0.45 },
    { y0: 0.55, y1: 1 },
  ]);
  // same physical box seen by both bands; center y=0.4 lies in band 0's core
  const box: NormalizedBox = { label: 'dup', x: 0.1, y: 0.35, w: 0.2, h: 0.1 };
  const { boxes, dropped } = mergeBandBoxes([[box], [{ ...box }]], bands);
  assert.equal(boxes.length, 1);
  assert.equal(dropped, 1);
});

test('mergeBandBoxes: high-IoU duplicates keep the larger box', () => {
  const bands = buildBands([]);
  const big: NormalizedBox = { label: 'big', x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  const small: NormalizedBox = {
    label: 'small',
    x: 0.11,
    y: 0.11,
    w: 0.28,
    h: 0.28,
  };
  const { boxes, dropped } = mergeBandBoxes([[small, big]], bands);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].label, 'big');
  assert.equal(dropped, 1);
});

test('mergeBandBoxes: distinct boxes survive in reading order', () => {
  const bands = buildBands([
    { y0: 0, y1: 0.45 },
    { y0: 0.55, y1: 1 },
  ]);
  const a: NormalizedBox = {
    label: 'top-left',
    x: 0.0,
    y: 0.1,
    w: 0.2,
    h: 0.1,
  };
  const b: NormalizedBox = {
    label: 'top-right',
    x: 0.5,
    y: 0.1,
    w: 0.2,
    h: 0.1,
  };
  const c: NormalizedBox = { label: 'bottom', x: 0.1, y: 0.7, w: 0.2, h: 0.1 };
  const { boxes, dropped } = mergeBandBoxes([[b, a], [c]], bands);
  assert.equal(dropped, 0);
  assert.deepEqual(
    boxes.map((x) => x.label),
    ['top-left', 'top-right', 'bottom']
  );
});

test('mergeSameLabelGroups: adjacent same-label boxes merge into one', () => {
  const boxes: NormalizedBox[] = [
    { label: 'Del Monte Corn', x: 0.1, y: 0.5, w: 0.06, h: 0.1 },
    { label: 'Del Monte Corn', x: 0.17, y: 0.5, w: 0.06, h: 0.1 },
    { label: 'Del Monte Corn', x: 0.24, y: 0.5, w: 0.06, h: 0.1 },
  ];
  const { boxes: out, merged } = mergeSameLabelGroups(boxes);
  assert.equal(out.length, 1);
  assert.equal(merged, 2);
  assert.ok(Math.abs(out[0].x - 0.1) < 1e-9);
  assert.ok(Math.abs(out[0].w - 0.2) < 1e-9);
});

test('mergeSameLabelGroups: far-apart same-label groups stay separate', () => {
  const boxes: NormalizedBox[] = [
    { label: 'Coke', x: 0.05, y: 0.1, w: 0.08, h: 0.1 },
    { label: 'Coke', x: 0.7, y: 0.8, w: 0.08, h: 0.1 },
  ];
  const { boxes: out, merged } = mergeSameLabelGroups(boxes);
  assert.equal(out.length, 2);
  assert.equal(merged, 0);
});

test('mergeSameLabelGroups: chain adjacency merges transitively, case-insensitive', () => {
  const boxes: NormalizedBox[] = [
    { label: 'Straw Mushrooms', x: 0.1, y: 0.3, w: 0.05, h: 0.08 },
    { label: 'straw  mushrooms', x: 0.16, y: 0.3, w: 0.05, h: 0.08 },
    { label: 'STRAW MUSHROOMS', x: 0.22, y: 0.3, w: 0.05, h: 0.08 },
  ];
  const { boxes: out } = mergeSameLabelGroups(boxes);
  assert.equal(out.length, 1);
});

test('mergeSameLabelGroups: different/empty labels never merge', () => {
  const boxes: NormalizedBox[] = [
    { label: 'A', x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    { label: 'B', x: 0.15, y: 0.1, w: 0.1, h: 0.1 },
    { label: '', x: 0.12, y: 0.1, w: 0.1, h: 0.1 },
    { label: '', x: 0.13, y: 0.1, w: 0.1, h: 0.1 },
  ];
  const { boxes: out, merged } = mergeSameLabelGroups(boxes);
  assert.equal(out.length, 4);
  assert.equal(merged, 0);
});

test('normalizeDetectedRows: swaps reversed pairs and rescales 0-1000', () => {
  const rows = normalizeDetectedRows([
    { y0: 300, y1: 100 },
    { y0: 400, y1: 700 },
  ]);
  assert.deepEqual(rows, [
    { y0: 0.1, y1: 0.3 },
    { y0: 0.4, y1: 0.7 },
  ]);
});

test('normalizeDetectedRows: detects 0-1 fractional scale', () => {
  const rows = normalizeDetectedRows([
    { y0: 0.1, y1: 0.3 },
    { y0: 0.4, y1: 0.7 },
  ]);
  assert.deepEqual(rows, [
    { y0: 0.1, y1: 0.3 },
    { y0: 0.4, y1: 0.7 },
  ]);
});
