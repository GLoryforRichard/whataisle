/**
 * Palette try-on screenshot matrix (TEMPORARY, for the owner's color
 * decision — delete together with the globals.css palette blocks).
 *
 * Captures home, pricing and the seeded demo store under every candidate
 * palette × desktop/mobile, plus a contact-sheet.html to swipe through.
 *
 * Usage:
 *   pnpm dev            # in another terminal, with the demo store seeded
 *   pnpm tsx scripts/palette-shots.mts
 *
 * Output: palette-shots/ (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const DEMO_URL = process.env.DEMO_URL ?? 'http://demo.localhost:3000';
const OUT = 'palette-shots';

const PALETTES = ['default', 'jujube', 'persimmon', 'navy', 'tea'] as const;
const PALETTE_LABELS: Record<string, string> = {
  default: '现绿',
  jujube: '甲 枣红暖金',
  persimmon: '乙 柿子暖橙',
  navy: '丙 藏蓝米金',
  tea: '丁 茶叶绿米金',
};

const PAGES: Array<[name: string, url: string]> = [
  ['home', `${BASE_URL}/zh`],
  ['pricing', `${BASE_URL}/zh/pricing`],
  ['store', `${DEMO_URL}/`],
];

const VIEWPORTS: Array<[name: string, width: number, height: number]> = [
  ['desktop', 1280, 860],
  ['mobile', 390, 844],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const files: string[] = [];

for (const [vpName, width, height] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  for (const [pageName, url] of PAGES) {
    await page.goto(url, { waitUntil: 'networkidle' });
    // The dev-only picker would photobomb full-page captures; hide it and
    // set the attribute directly instead.
    await page.addStyleTag({
      content: '[class*="bottom-4"][class*="z-\\[100\\]"]{display:none}',
    });
    // Slow-walk once so whileInView visuals have fired before any capture.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += height / 8) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(150);
    }
    for (const palette of PALETTES) {
      await page.evaluate((value) => {
        if (value === 'default') {
          delete document.documentElement.dataset.palette;
        } else {
          document.documentElement.dataset.palette = value;
        }
        window.scrollTo(0, 0);
      }, palette);
      await page.waitForTimeout(400);
      const file = `${pageName}-${palette}-${vpName}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
      files.push(file);
      console.log(`captured ${file}`);
    }
  }
  await context.close();
}
await browser.close();

// One swipeable overview: pages as sections, palettes side by side.
const sheet = `<!doctype html><meta charset="utf-8">
<title>WhatAisle 配色对比</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #fafafa; }
  h2 { margin: 32px 0 12px; }
  .row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; }
  figure { margin: 0; flex: 0 0 auto; }
  figcaption { font-weight: 600; padding: 6px 2px; }
  img { width: 420px; border: 1px solid #ddd; border-radius: 8px; display: block; }
  .mobile img { width: 220px; }
</style>
${PAGES.map(
  ([pageName]) => `
<h2>${pageName}</h2>
${VIEWPORTS.map(
  ([vpName]) => `
<div class="row ${vpName}">
${PALETTES.map(
  (palette) => `
  <figure>
    <figcaption>${PALETTE_LABELS[palette]}</figcaption>
    <img src="${pageName}-${palette}-${vpName}.png" loading="lazy" alt="${pageName} ${palette} ${vpName}">
  </figure>`
).join('')}
</div>`
).join('')}`
).join('')}
`;
writeFileSync(`${OUT}/contact-sheet.html`, sheet);
console.log(`done — open ${OUT}/contact-sheet.html`);
