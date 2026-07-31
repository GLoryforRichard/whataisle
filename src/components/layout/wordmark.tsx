import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';

type WordmarkSize = 'sm' | 'md' | 'lg';

interface WordmarkProps {
  size?: WordmarkSize;
  className?: string;
}

/** [text class, underline bottom offset px, sparkle placement] per size. */
const SIZES: Record<
  WordmarkSize,
  { text: string; underlineBottom: number; sparkle: string }
> = {
  sm: {
    text: 'text-lg',
    underlineBottom: -6,
    sparkle: '-top-1 -right-3 size-2.5',
  },
  md: {
    text: 'text-xl',
    underlineBottom: -7,
    sparkle: '-top-1 -right-3.5 size-3',
  },
  lg: {
    text: 'text-3xl',
    underlineBottom: -9,
    sparkle: '-top-1.5 -right-4 size-3.5',
  },
};

/**
 * The brand lockup — live text, never an image (wherebear signature): a
 * two-tone word with a hand-drawn yellow marker underline beneath the orange
 * segment and a small yellow four-point sparkle at the top right.
 * EN: "What" (ink) + "Aisle" (orange). ZH: 「找货」 (ink) + 「熊」 (orange).
 * Locale-reactive via next-intl (works in both server and client trees).
 * Usually paired with <BearFace> to its left; the sparkle overhangs the text
 * box, so give the parent a little right breathing room.
 */
export function Wordmark({ size = 'md', className }: WordmarkProps) {
  const locale = useLocale();
  const zh = locale === 'zh';
  const [head, tail] = zh ? ['找货', '熊'] : ['What', 'Aisle'];
  const s = SIZES[size];

  return (
    <span
      role="img"
      aria-label={zh ? '找货熊' : 'WhatAisle'}
      className={cn(
        'wa-display relative inline-flex items-baseline font-bold text-foreground',
        s.text,
        className
      )}
    >
      <span aria-hidden>{head}</span>
      <span aria-hidden className="relative inline-block text-[var(--brand)]">
        {tail}
        {/* Hand-drawn marker stroke (wherebear path), hugging the orange
            segment's baseline. */}
        <svg
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute right-0 left-0 w-full"
          style={{ bottom: s.underlineBottom, height: 10 }}
        >
          <path
            d="M4 8 C 28 3, 64 3, 96 6"
            fill="none"
            stroke="var(--brand-accent)"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </svg>
        {/* Four-point sparkle (wherebear icon path). */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={cn('pointer-events-none absolute', s.sparkle)}
        >
          <path
            d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6Z"
            fill="var(--brand-accent)"
          />
        </svg>
      </span>
    </span>
  );
}
