'use client';

import { CameraIcon, MicIcon, SearchIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { Variants } from 'motion/react';

/**
 * Step 03 visual: a phone mockup shows the three ways shoppers search —
 * typing, hold-to-talk voice, and a photo. Static-first: the three rows
 * fade in once when scrolled into view, then nothing moves. The earlier
 * per-character typing animation and looping voice bars were dropped on
 * purpose — endless motion reads as noise to the 45-60yo store owners
 * this page sells to.
 */

const phoneVariant: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const rowVariant: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  }),
};

// Static waveform bar heights (px) — drawn once, never animated.
const WAVE_HEIGHTS = [10, 18, 26, 16, 22, 12];

interface SearchWaysVisualProps {
  typedQuery: string;
  voiceLabel: string;
  photoLabel: string;
}

export function SearchWaysVisual({
  typedQuery,
  voiceLabel,
  photoLabel,
}: SearchWaysVisualProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      variants={phoneVariant}
      aria-hidden="true"
      className="w-[260px] rounded-[30px] bg-[var(--brand-paper)] p-4 shadow-[0_18px_44px_color-mix(in_srgb,var(--brand-ink)_16%,transparent)]"
    >
      <div className="overflow-hidden rounded-[20px] border border-border bg-white">
        <div className="flex items-center justify-between bg-[var(--brand)] px-3.5 py-3">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-[var(--brand-paper)]/40" />
            <span className="size-2 rounded-full bg-[var(--brand-paper)]/40" />
            <span className="size-2 rounded-full bg-[var(--brand-accent)]" />
          </span>
          <span className="text-[11px] text-[var(--brand-accent)]">中/EN</span>
        </div>

        <div className="flex flex-col gap-3 p-3.5">
          {/* 1 — type it */}
          <motion.div
            custom={0.1}
            variants={rowVariant}
            className="flex items-center gap-2 rounded-full border border-border bg-[var(--background)] px-3 py-2.5"
          >
            <SearchIcon className="size-4 shrink-0 text-[var(--brand)]" />
            <span className="font-medium text-[13px] text-[var(--brand-ink)]">
              {typedQuery}
            </span>
          </motion.div>

          {/* 2 — say it */}
          <motion.div
            custom={0.25}
            variants={rowVariant}
            className="flex items-center gap-3 rounded-2xl border border-[var(--accent-border)] bg-accent px-3 py-2.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-accent)]">
              <MicIcon className="size-4 text-[var(--brand)]" />
            </span>
            <span className="flex h-7 items-center gap-[3px]">
              {WAVE_HEIGHTS.map((height, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-[var(--brand)]"
                  style={{ height: `${height}px` }}
                />
              ))}
            </span>
            <span className="ml-auto font-semibold text-[11px] text-[var(--brand)]">
              {voiceLabel}
            </span>
          </motion.div>

          {/* 3 — snap it */}
          <motion.div
            custom={0.4}
            variants={rowVariant}
            className="flex items-center gap-3 rounded-2xl border border-border bg-[var(--background)] px-3 py-2.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--brand)]">
              <CameraIcon className="size-4 text-[var(--brand-accent)]" />
            </span>
            <span className="font-semibold text-[11px] text-muted-foreground">
              {photoLabel}
            </span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
