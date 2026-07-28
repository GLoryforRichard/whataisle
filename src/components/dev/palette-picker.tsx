'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

/**
 * TEMPORARY palette + style try-on switcher for the owner's design
 * decision.
 *
 * Sets html[data-palette] and html[data-style] (see the override blocks
 * in globals.css) and remembers both in localStorage. Rendered only in
 * development or when NEXT_PUBLIC_PALETTE_PREVIEW=true — never in E2E
 * (a floating fixed-position widget would overlap bottom-anchored
 * assertions) and never in production by default. Delete together with
 * the globals.css try-on blocks once the owner picks.
 */

const PALETTE_KEY = 'wa-palette';
const STYLE_KEY = 'wa-style';

const PALETTES: Array<{ value: string; label: string; dot: string }> = [
  { value: '', label: '现绿', dot: '#0f4c3f' },
  { value: 'jujube', label: '甲 枣红', dot: '#9c3d2e' },
  { value: 'persimmon', label: '乙 柿橙', dot: '#b04e1f' },
  { value: 'navy', label: '丙 藏蓝', dot: '#24406b' },
  { value: 'tea', label: '丁 茶绿', dot: '#1e5241' },
  { value: 'lake', label: '戊 湖蓝', dot: '#2765a8' },
  { value: 'lakemono', label: '戊² 湖蓝净白', dot: '#8fc1e8' },
  { value: 'lakered', label: '戊³ 湖蓝映红', dot: '#c8433c' },
  { value: 'teal', label: '己 青碧', dot: '#14796b' },
  { value: 'coffee', label: '庚 咖啡', dot: '#6e4b2a' },
  { value: 'burgundy', label: '辛 酒红', dot: '#7e2d40' },
  { value: 'inkgold', label: '壬 黑金', dot: '#2e2a25' },
];

const STYLES: Array<{ value: string; label: string }> = [
  { value: '', label: '填色块' },
  { value: 'outline', label: '线条感' },
];

function applyAttr(name: 'palette' | 'style', value: string) {
  if (value) {
    document.documentElement.dataset[name] = value;
  } else {
    delete document.documentElement.dataset[name];
  }
}

export function PalettePicker() {
  const [palette, setPalette] = useState('');
  const [style, setStyle] = useState('');

  useEffect(() => {
    const savedPalette = localStorage.getItem(PALETTE_KEY) ?? '';
    const savedStyle = localStorage.getItem(STYLE_KEY) ?? '';
    setPalette(savedPalette);
    setStyle(savedStyle);
    applyAttr('palette', savedPalette);
    applyAttr('style', savedStyle);
  }, []);

  const selectPalette = (value: string) => {
    setPalette(value);
    applyAttr('palette', value);
    localStorage.setItem(PALETTE_KEY, value);
  };

  const selectStyle = (value: string) => {
    setStyle(value);
    applyAttr('style', value);
    localStorage.setItem(STYLE_KEY, value);
  };

  return (
    <div className="fixed bottom-4 left-4 z-[100] flex max-w-[min(94vw,560px)] flex-col gap-1 rounded-2xl border border-border bg-white p-1.5 shadow-lg">
      <div className="flex flex-wrap items-center gap-1">
        {PALETTES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={palette === option.value}
            onClick={() => selectPalette(option.value)}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              palette === option.value
                ? 'bg-[var(--brand)] font-semibold text-white'
                : 'text-foreground hover:bg-muted'
            )}
          >
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: option.dot }}
            />
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-border border-t pt-1">
        <span className="px-2 text-muted-foreground text-xs">风格</span>
        {STYLES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={style === option.value}
            onClick={() => selectStyle(option.value)}
            className={cn(
              'cursor-pointer rounded-full px-2.5 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              style === option.value
                ? 'bg-[var(--brand)] font-semibold text-white'
                : 'text-foreground hover:bg-muted'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
