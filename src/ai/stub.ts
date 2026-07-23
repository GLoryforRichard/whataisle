import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Deterministic stub AI, used when no DashScope credentials are configured
 * (isAiConfigured() === false). Lets the scan → dedup → save → alias → embed →
 * seen-count pipeline and the search pipeline be exercised end-to-end offline
 * (local dev without a key, CI without burning quota).
 *
 * Everything here is derived deterministically from inputs, so tests are
 * reproducible. Real recognition drops in the moment credentials are present.
 */

/** A small catalog the stub "recognizes" so shelves look plausible. */
const STUB_CATALOG = [
  { name: 'Wang Korea Gochujang', category: 'sauce', zh: '王家韩式辣椒酱' },
  { name: 'Lao Gan Ma Chili Crisp', category: 'sauce', zh: '老干妈油辣椒' },
  { name: 'Kewpie Mayonnaise', category: 'sauce', zh: '丘比蛋黄酱' },
  { name: 'Samyang Buldak Ramen', category: 'noodle', zh: '三养火鸡面' },
  { name: 'Nongshim Shin Ramyun', category: 'noodle', zh: '农心辛拉面' },
  { name: 'Pocky Strawberry', category: 'snack', zh: '百奇草莓' },
  {
    name: 'Haitai Honey Butter Chips',
    category: 'snack',
    zh: '海太蜂蜜黄油薯片',
  },
  { name: 'Sushi Nori', category: 'dry-good', zh: '寿司海苔' },
  { name: 'Mung Beans', category: 'dry-good', zh: '绿豆' },
  { name: 'Coca-Cola 330ml Can', category: 'drink', zh: '可口可乐' },
];

function hashInt(input: string): number {
  const h = createHash('sha256').update(input).digest();
  return h.readUInt32BE(0);
}

export interface StubBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Deterministic fake shelf layout for the scan engine: 2–4 catalog items
 * laid out as shelf rows (fractional coords), seeded by a photo key. Used by
 * both the staff scan and the landing try-out when OpenRouter is not
 * configured, so both flows can be exercised fully offline.
 */
export function stubScanBoxes(seed: string): StubBox[] {
  const base = hashInt(seed);
  const count = 2 + (base % 3); // 2–4
  const boxes: StubBox[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = (base + i * 7) % STUB_CATALOG.length;
    if (used.has(idx)) continue;
    used.add(idx);
    const x = 0.08 + ((base >>> (i * 3)) % 4) * 0.17;
    boxes.push({
      label: STUB_CATALOG[idx].name,
      x: Math.min(x, 0.68),
      y: 0.12 + i * 0.22,
      w: 0.24,
      h: 0.16,
    });
  }
  return boxes;
}

/** Deterministic bilingual alias set for the stub. */
export function stubAliases(name: string): {
  en: string[];
  zh: string[];
  pinyin: string[];
  misspelling: string[];
} {
  const match = STUB_CATALOG.find((c) => c.name === name);
  return {
    en: [],
    zh: match ? [match.zh] : [],
    pinyin: [],
    misspelling: [],
  };
}

/** Deterministic unit-norm embedding, seeded by text. */
export function stubEmbedding(text: string, dim: number): number[] {
  const vec = new Array<number>(dim);
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = (hashInt(`${text}:${i}`) / 0xffffffff) * 2 - 1;
    vec[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}
