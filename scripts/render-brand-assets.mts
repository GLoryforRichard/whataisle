/**
 * One-shot brand asset renderer — regenerates every binary in public/
 * from the 找货熊 detective-bear art (scripts/assets/bear-source.png, the
 * 1254² original ported from the wherebear repo) in the bear sticker
 * palette (cream / ink / orange / yellow).
 *
 * Usage:
 *   pnpm tsx scripts/render-brand-assets.mts
 *   # favicon.ico = the two favicon PNGs embedded per the ICO spec.
 *   # (`pnpm dlx png-to-ico` emitted a broken fixed 285KB blob regardless of
 *   # input — 2026-07; the inline python below writes a 2KB PNG-embedded ico.)
 *   python3 - <<'PY'
 *   import struct, pathlib
 *   parts, datas = [], []
 *   for p in ['public/favicon-32x32.png', 'public/favicon-16x16.png']:
 *       d = pathlib.Path(p).read_bytes()
 *       parts.append((int.from_bytes(d[16:20],'big')%256, int.from_bytes(d[20:24],'big')%256, len(d))); datas.append(d)
 *   hdr = struct.pack('<HHH', 0, 1, len(parts)); off = len(hdr) + 16*len(parts); dirs = b''; body = b''
 *   for (w,h,n), d in zip(parts, datas):
 *       dirs += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, n, off); body += d; off += n
 *   pathlib.Path('public/favicon.ico').write_bytes(hdr + dirs + body)
 *   PY
 *
 * Keep the colors in sync with src/styles/globals.css. The bear source has
 * a WHITE MATTE, not alpha — it is composited with mix-blend-mode:multiply
 * inside an isolated chip so the matte vanishes against the cream fill
 * (Playwright screenshots flatten the blend, so the outputs are plain
 * pixels). After regenerating, bump the og.png `?v=` cache-buster in
 * src/config/website.tsx.
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BG = '#fdf7e3';
const PRIMARY = '#ff8a00';
const ACCENT = '#ffc900';
const INK = '#111111';
const MUTED = '#6a6359';

const BEAR_URI = `data:image/png;base64,${readFileSync(
  'scripts/assets/bear-source.png'
).toString('base64')}`;

/** The bear multiplied over its container's fill (matte disappears). */
function bearImg(size: number): string {
  return `<img src="${BEAR_URI}" width="${size}" height="${size}"
    style="display:block;object-fit:contain;mix-blend-mode:multiply;" />`;
}

/** Rounded cream chip holding the bear — the app-icon form of the mark. */
function chipHtml(size: number, radiusRatio: number, border: number): string {
  const glyph = Math.round(size * 0.82);
  return `<div style="width:${size}px;height:${size}px;background:${BG};
    border:${border}px solid ${INK};box-sizing:border-box;
    border-radius:${Math.round(size * radiusRatio)}px;display:flex;
    align-items:center;justify-content:center;isolation:isolate;
    overflow:hidden;">${bearImg(glyph)}</div>`;
}

const page = await (await chromium.launch()).newPage();

async function shoot(
  html: string,
  width: number,
  height: number,
  path: string,
  transparent: boolean,
  head = ''
) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<head>${head}</head><body style="margin:0;${transparent ? '' : `background:${BG};`}
      display:flex;align-items:center;justify-content:center;
      width:${width}px;height:${height}px;">${html}</body>`
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: transparent });
  console.log(`rendered ${path}`);
}

// Favicons + logo chip (also the email header + Discord avatar).
// The 16px chip is too small for a border; 32 gets 1px, 256 gets 8px.
await shoot(chipHtml(16, 0.22, 0), 16, 16, 'public/favicon-16x16.png', true);
await shoot(chipHtml(32, 0.22, 1), 32, 32, 'public/favicon-32x32.png', true);
await shoot(chipHtml(256, 0.22, 8), 256, 256, 'public/logo.png', true);
// The product is light-only; logo-dark is the same chip (kept so the
// config's logoDark path stays valid).
await shoot(chipHtml(256, 0.22, 8), 256, 256, 'public/logo-dark.png', true);

// Apple touch icon: white plate, chip centered (iOS rounds the plate).
await shoot(
  chipHtml(124, 0.22, 4),
  180,
  180,
  'public/apple-touch-icon.png',
  false
);

// Android maskable: full-bleed cream, bear inside the 80% safe zone.
for (const size of [192, 512]) {
  const glyph = Math.round(size * 0.56);
  await shoot(
    `<div style="width:${size}px;height:${size}px;background:${BG};
      display:flex;align-items:center;justify-content:center;
      isolation:isolate;">${bearImg(glyph)}</div>`,
    size,
    size,
    `public/android-chrome-${size}x${size}.png`,
    false
  );
}

// OG / social share card, 1200x630. Space Grotesk for the Latin wordmark
// (loaded from Google Fonts at render time only — the app self-hosts via
// next/font), system CJK for the Chinese lines.
const OG_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
`;
await shoot(
  `<div style="width:1200px;height:630px;position:relative;
     background:radial-gradient(circle at 20% 10%, #fefbf2 0%, #fdf7e3 55%, #f7eed6 100%);
     font-family:'Space Grotesk','PingFang SC','Noto Sans SC',system-ui,sans-serif;">
    <div style="position:absolute;top:0;left:0;right:0;height:18px;background:${PRIMARY};border-bottom:3px solid ${INK};"></div>
    <!-- no isolation here: the bear must multiply against the page gradient
         itself, otherwise its white matte survives as a white square -->
    <div style="position:absolute;left:72px;top:120px;width:280px;height:280px;">${bearImg(280)}</div>
    <div style="position:absolute;left:400px;top:150px;display:flex;align-items:baseline;gap:24px;">
      <span style="font-size:88px;font-weight:700;color:${INK};letter-spacing:-1px;">找货熊</span>
      <span style="font-size:84px;font-weight:700;letter-spacing:-2.5px;position:relative;">
        <span style="color:${INK};">What</span><span style="color:${PRIMARY};position:relative;display:inline-block;">Aisle<svg viewBox="0 0 100 12" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:-16px;width:100%;height:22px;"><path d="M4 8 C 28 3, 64 3, 96 6" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round"/></svg></span>
      </span>
    </div>
    <div style="position:absolute;left:400px;top:330px;font-size:50px;font-weight:700;color:${INK};">
      顾客扫码一问，马上知道<br/>商品在哪个货架
    </div>
    <div style="position:absolute;left:400px;top:508px;font-size:32px;color:${MUTED};">
      www.whataisle.com · 社区超市的找货助手
    </div>
  </div>`,
  1200,
  630,
  'public/og.png',
  false,
  OG_FONTS
);

await page.context().browser()?.close();
console.log('done');
