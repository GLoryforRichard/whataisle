/**
 * One-shot brand asset renderer — regenerates every binary in public/
 * from the same cart-in-chip mark the inline Logo component draws, in
 * the current brand palette (湖蓝净白 lake blue).
 *
 * Usage:
 *   pnpm tsx scripts/render-brand-assets.mts
 *   pnpm dlx png-to-ico public/favicon-32x32.png public/favicon-16x16.png > public/favicon.ico
 *
 * Keep the colors in sync with --brand / --brand-accent /
 * --brand-accent-foreground in src/styles/globals.css.
 */
import { chromium } from '@playwright/test';

const BRAND = '#2765a8';
const CHIP = '#8fc1e8';
const GLYPH = '#24344a';
const INK = '#24344a';
const MUTED = '#51617a';

const CART_PATHS = `
  <circle cx="8" cy="21" r="1" />
  <circle cx="19" cy="21" r="1" />
  <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
`;

function cartSvg(size: number, color: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2.2" stroke-linecap="round"
    stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${CART_PATHS}</svg>`;
}

/** Rounded chip holding the cart — the app-icon form of the mark. */
function chipHtml(size: number, radiusRatio: number): string {
  const glyph = Math.round(size * 0.6);
  return `<div style="width:${size}px;height:${size}px;background:${CHIP};
    border-radius:${Math.round(size * radiusRatio)}px;display:flex;
    align-items:center;justify-content:center;">${cartSvg(glyph, GLYPH)}</div>`;
}

const page = await (await chromium.launch()).newPage();

async function shoot(
  html: string,
  width: number,
  height: number,
  path: string,
  transparent: boolean
) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<body style="margin:0;${transparent ? '' : 'background:#ffffff;'}
      display:flex;align-items:center;justify-content:center;
      width:${width}px;height:${height}px;">${html}</body>`
  );
  await page.screenshot({ path, omitBackground: transparent });
  console.log(`rendered ${path}`);
}

// Favicons + Discord avatar: transparent chip.
await shoot(chipHtml(16, 0.22), 16, 16, 'public/favicon-16x16.png', true);
await shoot(chipHtml(32, 0.22), 32, 32, 'public/favicon-32x32.png', true);
await shoot(chipHtml(256, 0.22), 256, 256, 'public/logo.png', true);
await shoot(chipHtml(256, 0.22), 256, 256, 'public/logo-dark.png', true);

// Apple touch icon: white plate, chip centered (iOS rounds the plate).
await shoot(
  chipHtml(124, 0.22),
  180,
  180,
  'public/apple-touch-icon.png',
  false
);

// Android maskable: full-bleed chip color, glyph inside the 80% safe zone.
for (const size of [192, 512]) {
  const glyph = Math.round(size * 0.5);
  await shoot(
    `<div style="width:${size}px;height:${size}px;background:${CHIP};
      display:flex;align-items:center;justify-content:center;">
      ${cartSvg(glyph, GLYPH)}</div>`,
    size,
    size,
    `public/android-chrome-${size}x${size}.png`,
    false
  );
}

// OG / social share card, 1200x630, flat colors, well under 100KB.
await shoot(
  `<div style="width:1200px;height:630px;background:#ffffff;position:relative;
     font-family:'PingFang SC','Noto Sans SC',system-ui,sans-serif;">
    <div style="position:absolute;top:0;left:0;right:0;height:18px;background:${BRAND};"></div>
    <div style="position:absolute;left:96px;top:150px;display:flex;align-items:center;gap:28px;">
      ${chipHtml(104, 0.22)}
      <span style="font-size:84px;font-weight:700;color:${INK};">WhatAisle</span>
    </div>
    <div style="position:absolute;left:96px;top:330px;font-size:52px;font-weight:700;color:${INK};">
      顾客扫码一问，马上知道商品在哪个货架
    </div>
    <div style="position:absolute;left:96px;top:430px;width:132px;height:10px;
      background:${CHIP};border-radius:5px;"></div>
    <div style="position:absolute;left:96px;top:486px;font-size:34px;color:${MUTED};">
      www.whataisle.com · 社区超市的找货助手
    </div>
  </div>`,
  1200,
  630,
  'public/og.png',
  false
);

await page.context().browser()?.close();
console.log('done');
