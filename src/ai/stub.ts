import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Deterministic stub AI, used when no Gemini credentials are configured
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

export interface StubProduct {
  name: string;
  nameZh: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Deterministically pick 2–4 catalog items for a shelf photo, seeded by a
 * photo key so re-scanning the same photo is idempotent but different photos
 * yield different products.
 */
export function stubDetectProducts(seed: string): StubProduct[] {
  const base = hashInt(seed);
  const count = 2 + (base % 3); // 2–4
  const picks: StubProduct[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = (base + i * 7) % STUB_CATALOG.length;
    if (used.has(idx)) continue;
    used.add(idx);
    const item = STUB_CATALOG[idx];
    picks.push({
      name: item.name,
      nameZh: item.zh,
      category: item.category,
      confidence: 'high',
    });
  }
  return picks;
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
