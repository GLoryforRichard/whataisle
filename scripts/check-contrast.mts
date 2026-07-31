/**
 * Contrast guard for the 找货熊 bear (Wherebear 3.0 neo-brutalist) palette.
 *
 * Checks every text/background pairing the design relies on against
 * WCAG AA (4.5:1 for body-size text). Run after any token change in
 * src/styles/globals.css:
 *
 *   pnpm tsx scripts/check-contrast.mts
 *
 * Exits non-zero on the first failing pair. The conventions it protects:
 * text on brand/accent FILLS is INK (#111) — white-on-orange is 2.4:1 and
 * must never carry text. The only white-on-orange surfaces are the three
 * deliberate exceptions (aisle-code chips, the map's selected shelf, the
 * active locale-toggle segment — all large/bold, listed in CLAUDE.md);
 * they are exempt from this guard by design. Deep companions carry text on
 * tints: --brand-dark on orange tints, --brand-accent-foreground on yellow
 * tints.
 */

const TOKENS = {
  brand: '#ff8a00',
  brandHover: '#e67c00',
  brandAccent: '#ffc900',
  brandAccentForeground: '#6b5200',
  brandDark: '#8a4a00',
  brandSofter: '#ffefdc',
  ink: '#111111',
  white: '#ffffff',
  cream: '#fdf7e3',
  creamMuted: '#f6eed6',
  accentBg: '#fff1c2',
  accentTint: '#fffae6',
  mutedForeground: '#6a6359',
  destructive: '#c1272d',
  mapTarget: '#cf343a',
};

const CHECKS: Array<[label: string, fg: string, bg: string, min: number]> = [
  ['ink on brand (primary buttons, CTAs)', TOKENS.ink, TOKENS.brand, 4.5],
  ['ink on brand-hover', TOKENS.ink, TOKENS.brandHover, 4.5],
  [
    'ink on accent (yellow chips, scan band)',
    TOKENS.ink,
    TOKENS.brandAccent,
    4.5,
  ],
  ['ink on cream page background', TOKENS.ink, TOKENS.cream, 4.5],
  [
    'ink on deeper cream (footer, sidebar, muted)',
    TOKENS.ink,
    TOKENS.creamMuted,
    4.5,
  ],
  ['ink on white cards', TOKENS.ink, TOKENS.white, 4.5],
  ['muted-foreground on white', TOKENS.mutedForeground, TOKENS.white, 4.5],
  ['muted-foreground on cream', TOKENS.mutedForeground, TOKENS.cream, 4.5],
  [
    'brand-dark on brand-softer (secondary pair, chips)',
    TOKENS.brandDark,
    TOKENS.brandSofter,
    4.5,
  ],
  [
    'accent-foreground on accent-bg (accent pair, bands)',
    TOKENS.brandAccentForeground,
    TOKENS.accentBg,
    4.5,
  ],
  [
    'accent-foreground on accent-tint (speech bubbles)',
    TOKENS.brandAccentForeground,
    TOKENS.accentTint,
    4.5,
  ],
  ['white on destructive', TOKENS.white, TOKENS.destructive, 4.5],
  ['white on map-target pin', TOKENS.white, TOKENS.mapTarget, 4.5],
];

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = Number.parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

let failed = false;
for (const [label, fg, bg, min] of CHECKS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}  ${label}`);
}
if (failed) {
  console.error('\nContrast check failed — fix the token values above.');
  process.exit(1);
}
console.log('\nAll contrast pairs pass WCAG AA.');
