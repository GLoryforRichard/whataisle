/**
 * Palette + style try-on screenshot matrix (TEMPORARY, for the owner's
 * design decision — delete together with the globals.css try-on blocks).
 *
 * Matrix (≈50 shots):
 *   home     desktop × every palette × both styles (填色/线条), mobile filled
 *   pricing  desktop × every palette, filled
 *   store    mobile  × every palette, filled
 * plus contact-sheet.html to swipe through everything.
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

const PALETTES = [
  'default',
  'jujube',
  'persimmon',
  'navy',
  'tea',
  'lake',
  'teal',
  'coffee',
  'burgundy',
  'inkgold',
] as const;

const PALETTE_LABELS: Record<string, string> = {
  default: '现绿',
  jujube: '甲 枣红暖金',
  persimmon: '乙 柿子暖橙',
  navy: '丙 藏蓝米金',
  tea: '丁 茶叶绿米金',
  lake: '戊 湖蓝清爽',
  teal: '己 青碧市集',
  coffee: '庚 咖啡暖棕',
  burgundy: '辛 酒红香槟',
  inkgold: '壬 墨黑描金',
};

const STYLE_LABELS: Record<string, string> = {
  filled: '填色块',
  outline: '线条感',
};

interface Shot {
  page: string;
  url: string;
  viewport: { width: number; height: number };
  vpName: string;
  styles: Array<'filled' | 'outline'>;
}

const SHOTS: Shot[] = [
  {
    page: 'home',
    url: `${BASE_URL}/zh`,
    viewport: { width: 1280, height: 860 },
    vpName: 'desktop',
    styles: ['filled', 'outline'],
  },
  {
    page: 'home',
    url: `${BASE_URL}/zh`,
    viewport: { width: 390, height: 844 },
    vpName: 'mobile',
    styles: ['filled'],
  },
  {
    page: 'pricing',
    url: `${BASE_URL}/zh/pricing`,
    viewport: { width: 1280, height: 860 },
    vpName: 'desktop',
    styles: ['filled'],
  },
  {
    page: 'store',
    url: `${DEMO_URL}/`,
    viewport: { width: 390, height: 844 },
    vpName: 'mobile',
    styles: ['filled'],
  },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(shot.url, { waitUntil: 'networkidle' });
  // The dev-only picker would photobomb full-page captures; hide it and
  // set the attributes directly instead.
  await page.addStyleTag({
    content: '[class*="bottom-4"][class*="z-\\[100\\]"]{display:none}',
  });
  // Slow-walk once so whileInView visuals have fired before any capture.
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += height / 8) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }

  for (const style of shot.styles) {
    for (const palette of PALETTES) {
      await page.evaluate(
        ([paletteValue, styleValue]) => {
          if (paletteValue === 'default') {
            delete document.documentElement.dataset.palette;
          } else {
            document.documentElement.dataset.palette = paletteValue;
          }
          if (styleValue === 'filled') {
            delete document.documentElement.dataset.style;
          } else {
            document.documentElement.dataset.style = styleValue;
          }
          window.scrollTo(0, 0);
        },
        [palette, style]
      );
      await page.waitForTimeout(350);
      const file = `${shot.page}-${palette}-${style}-${shot.vpName}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
      console.log(`captured ${file}`);
    }
  }
  await context.close();
}
await browser.close();

// One swipeable overview: sections per page/style, palettes side by side.
const sections = SHOTS.flatMap((shot) =>
  shot.styles.map((style) => ({
    title: `${shot.page} · ${STYLE_LABELS[style]} · ${shot.vpName}`,
    vpName: shot.vpName,
    files: PALETTES.map((palette) => ({
      palette,
      file: `${shot.page}-${palette}-${style}-${shot.vpName}.png`,
    })),
  }))
);

const sheet = `<!doctype html><meta charset="utf-8">
<title>WhatAisle 配色与风格对比</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #fafafa; }
  h2 { margin: 32px 0 12px; }
  .row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; }
  figure { margin: 0; flex: 0 0 auto; }
  figcaption { font-weight: 600; padding: 6px 2px; }
  img { width: 420px; border: 1px solid #ddd; border-radius: 8px; display: block; }
  .mobile img { width: 220px; }
</style>
${sections
  .map(
    (section) => `
<h2>${section.title}</h2>
<div class="row ${section.vpName}">
${section.files
  .map(
    ({ palette, file }) => `
  <figure>
    <figcaption>${PALETTE_LABELS[palette]}</figcaption>
    <img src="${file}" loading="lazy" alt="${file}">
  </figure>`
  )
  .join('')}
</div>`
  )
  .join('')}
`;
writeFileSync(`${OUT}/contact-sheet.html`, sheet);
console.log(`done — open ${OUT}/contact-sheet.html`);
