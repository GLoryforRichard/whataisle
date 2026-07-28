'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

/**
 * TEMPORARY palette try-on switcher for the owner's color decision.
 *
 * Sets html[data-palette] (see the override blocks in globals.css) and
 * remembers the choice in localStorage. Rendered only in development or
 * when NEXT_PUBLIC_PALETTE_PREVIEW=true — never in E2E (a floating
 * fixed-position widget would overlap bottom-anchored assertions) and
 * never in production by default. Delete together with the globals.css
 * palette blocks once the owner picks.
 */

const STORAGE_KEY = 'wa-palette';

const PALETTES: Array<{ value: string; label: string; dot: string }> = [
  { value: '', label: '现绿', dot: '#0f4c3f' },
  { value: 'jujube', label: '甲 枣红', dot: '#9c3d2e' },
  { value: 'persimmon', label: '乙 柿橙', dot: '#b04e1f' },
  { value: 'navy', label: '丙 藏蓝', dot: '#24406b' },
  { value: 'tea', label: '丁 茶绿', dot: '#1e5241' },
];

function apply(value: string) {
  if (value) {
    document.documentElement.dataset.palette = value;
  } else {
    delete document.documentElement.dataset.palette;
  }
}

export function PalettePicker() {
  const [active, setActive] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? '';
    setActive(saved);
    apply(saved);
  }, []);

  const select = (value: string) => {
    setActive(value);
    apply(value);
    localStorage.setItem(STORAGE_KEY, value);
  };

  return (
    <div className="fixed bottom-4 left-4 z-[100] flex items-center gap-1 rounded-full border border-border bg-white p-1 shadow-lg">
      {PALETTES.map((palette) => (
        <button
          key={palette.value}
          type="button"
          aria-pressed={active === palette.value}
          onClick={() => select(palette.value)}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            active === palette.value
              ? 'bg-[var(--brand)] font-semibold text-white'
              : 'text-foreground hover:bg-muted'
          )}
        >
          <span
            aria-hidden
            className="size-3 rounded-full"
            style={{ backgroundColor: palette.dot }}
          />
          {palette.label}
        </button>
      ))}
    </div>
  );
}
