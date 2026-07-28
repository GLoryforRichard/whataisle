/**
 * Contrast guard for the 湖蓝净白 (lake blue) palette.
 *
 * Checks every text/background pairing the design relies on against
 * WCAG AA (4.5:1 for body-size text). Run after any token change in
 * src/styles/globals.css:
 *
 *   pnpm tsx scripts/check-contrast.mts
 *
 * Exits non-zero on the first failing pair. The one deliberate
 * convention it protects: text on brand-filled surfaces is WHITE, and
 * text on accent fills uses --brand-accent-foreground — never place
 * the accent color itself as text on the brand.
 */

const TOKENS = {
  brand: '#2765a8',
  brandHover: '#1e5290',
  brandAccent: '#8fc1e8',
  brandAccentForeground: '#24344a',
  ink: '#24344a',
  white: '#ffffff',
  secondary: '#e7eff7',
  secondaryForeground: '#2765a8',
  mutedForeground: '#51617a',
  accent: '#eaf2fa',
  accentForeground: '#2765a8',
  destructive: '#c1272d',
  mapTarget: '#cf343a',
};

const CHECKS: Array<[label: string, fg: string, bg: string, min: number]> = [
  ['white on brand (buttons, nav, footer)', TOKENS.white, TOKENS.brand, 4.5],
  ['white on brand-hover', TOKENS.white, TOKENS.brandHover, 4.5],
  ['brand on white (links, chip text)', TOKENS.brand, TOKENS.white, 4.5],
  ['ink on white (body)', TOKENS.ink, TOKENS.white, 4.5],
  ['muted-foreground on white', TOKENS.mutedForeground, TOKENS.white, 4.5],
  [
    'accent-foreground on accent chip fill',
    TOKENS.brandAccentForeground,
    TOKENS.brandAccent,
    4.5,
  ],
  [
    'accent-foreground on accent tint',
    TOKENS.accentForeground,
    TOKENS.accent,
    4.5,
  ],
  [
    'secondary-foreground on secondary tint',
    TOKENS.secondaryForeground,
    TOKENS.secondary,
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
