'use client';

import { CameraIcon, MicIcon, SearchIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Variants } from 'motion/react';

/**
 * Step 03 visual: a phone mockup demos the three ways shoppers search —
 * typing (character by character), hold-to-talk voice, and a photo. Plays
 * once when scrolled into view.
 */

const CHAR_DELAY = 0.08;
const TYPE_START = 0.7;

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

const charVariant: Variants = {
  hidden: { opacity: 0 },
  visible: (delay: number) => ({
    opacity: 1,
    transition: { delay, duration: 0.05 },
  }),
};

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
  const reducedMotion = useReducedMotion();
  // Array.from keeps CJK characters intact (no surrogate-pair splitting).
  const chars = Array.from(typedQuery);
  const typeDuration = chars.length * CHAR_DELAY;
  const voiceDelay = TYPE_START + typeDuration + 0.4;
  const photoDelay = voiceDelay + 0.5;

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      variants={phoneVariant}
      aria-hidden="true"
      className="w-[260px] rounded-[30px] bg-[var(--brand-cream)] p-4 shadow-[0_18px_44px_rgba(15,53,44,0.16)]"
    >
      <div className="overflow-hidden rounded-[20px] border border-[#E4DECB] bg-white">
        <div className="flex items-center justify-between bg-[var(--brand-green)] px-3.5 py-3">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-[var(--brand-cream)]/40" />
            <span className="size-2 rounded-full bg-[var(--brand-cream)]/40" />
            <span className="size-2 rounded-full bg-[var(--brand-lime)]" />
          </span>
          <span className="text-[11px] text-[var(--brand-lime)]">中/EN</span>
        </div>

        <div className="flex flex-col gap-3 p-3.5">
          {/* 1 — type it */}
          <motion.div
            custom={0.3}
            variants={rowVariant}
            className="flex items-center gap-2 rounded-full border border-[#E4DECB] bg-[#FAF8F2] px-3 py-2.5"
          >
            <SearchIcon className="size-4 shrink-0 text-[var(--brand-green)]" />
            <span className="font-medium text-[13px] text-[var(--brand-ink)]">
              {reducedMotion ? (
                typedQuery
              ) : (
                <>
                  {chars.map((char, i) => (
                    <motion.span
                      key={i}
                      custom={TYPE_START + i * CHAR_DELAY}
                      variants={charVariant}
                    >
                      {char}
                    </motion.span>
                  ))}
                  <span className="wa-caret ml-px inline-block h-[14px] w-[1.5px] translate-y-[2px] bg-[var(--brand-green)]" />
                </>
              )}
            </span>
          </motion.div>

          {/* 2 — say it */}
          <motion.div
            custom={reducedMotion ? 0 : voiceDelay}
            variants={rowVariant}
            className="flex items-center gap-3 rounded-2xl border border-[#D8EBB4] bg-[#F1F7E8] px-3 py-2.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-lime)]">
              <MicIcon className="size-4 text-[var(--brand-green)]" />
            </span>
            <span className="flex h-7 items-center gap-[3px]">
              {WAVE_HEIGHTS.map((height, i) => (
                <span
                  key={i}
                  className="wa-wave w-[3px] rounded-full bg-[var(--brand-green)]"
                  style={{
                    height: `${height}px`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </span>
            <span className="ml-auto font-semibold text-[11px] text-[#2E5A2A]">
              {voiceLabel}
            </span>
          </motion.div>

          {/* 3 — snap it */}
          <motion.div
            custom={reducedMotion ? 0 : photoDelay}
            variants={rowVariant}
            className="flex items-center gap-3 rounded-2xl border border-[#E4DECB] bg-[#FAF8F2] px-3 py-2.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#C0392B] to-[#7D6608]">
              <CameraIcon className="size-4 text-white" />
            </span>
            <span className="font-semibold text-[11px] text-[#566058]">
              {photoLabel}
            </span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
