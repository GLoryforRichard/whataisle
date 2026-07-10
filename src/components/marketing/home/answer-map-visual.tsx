'use client';

import { motion } from 'motion/react';
import type { Variants } from 'motion/react';

/**
 * Step 04 visual: the shopper's question gets a confident answer bubble, then
 * a mini floor map draws in with the target shelf pulsing red — the same
 * `wa-target` treatment the real shopper map uses (store-map-svg.tsx). Plays
 * once when scrolled into view.
 */

const HIGHLIGHT = '#e5484d';

const SHELVES: Array<{
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  target?: boolean;
}> = [
  { code: 'A1', x: 10, y: 12, w: 44, h: 18 },
  { code: 'B1', x: 66, y: 12, w: 44, h: 18 },
  { code: 'C1', x: 122, y: 12, w: 44, h: 18 },
  { code: 'A2', x: 10, y: 40, w: 44, h: 18 },
  { code: 'B2', x: 66, y: 40, w: 44, h: 18 },
  { code: 'C2', x: 122, y: 40, w: 44, h: 18 },
  { code: 'A3', x: 10, y: 68, w: 44, h: 18 },
  { code: 'B4', x: 66, y: 68, w: 44, h: 18, target: true },
  { code: 'C4', x: 122, y: 68, w: 44, h: 18 },
];

const askedVariant: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

const answerVariant: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.55, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const mapVariant: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { delay: 0.9, duration: 0.4 } },
};

const shelfVariant: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: 1 + i * 0.08, duration: 0.3 },
  }),
};

const pathVariant: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { delay: 1.8, duration: 0.8, ease: 'easeInOut' },
  },
};

const captionVariant: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { delay: 2.4, duration: 0.4 } },
};

interface AnswerMapVisualProps {
  demoAsked: string;
  demoAnswer: string;
  mapCaption: string;
}

export function AnswerMapVisual({
  demoAsked,
  demoAnswer,
  mapCaption,
}: AnswerMapVisualProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      aria-hidden="true"
      className="flex w-full max-w-[380px] flex-col gap-3 rounded-[20px] border border-[#EAE3D2] bg-white p-4 shadow-[0_1px_2px_rgba(15,53,44,0.04),0_14px_30px_rgba(15,53,44,0.06)]"
    >
      <motion.div
        variants={askedVariant}
        className="self-end rounded-2xl rounded-br-md bg-[#EEF0EA] px-3.5 py-2 text-[13px] text-[#40483F]"
      >
        {demoAsked}
      </motion.div>

      <motion.div
        variants={answerVariant}
        className="flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md border border-[#D8EBB4] bg-[#F1F7E8] p-2.5 pr-4"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-[var(--brand-lime)] font-bold text-[var(--brand-green)] text-xl">
          B4
        </span>
        <span className="font-semibold text-[#12352C] text-xs leading-snug">
          {demoAnswer}
        </span>
      </motion.div>

      <motion.div variants={mapVariant}>
        <svg
          viewBox="0 0 176 128"
          className="h-auto w-full rounded-2xl border border-[#EAE3D2] bg-[#FAF8F2]"
          role="presentation"
        >
          {SHELVES.map((shelf, i) => (
            <motion.g key={shelf.code} custom={i} variants={shelfVariant}>
              <rect
                x={shelf.x}
                y={shelf.y}
                width={shelf.w}
                height={shelf.h}
                rx="2"
                fill={shelf.target ? HIGHLIGHT : '#E9F0E5'}
                stroke={shelf.target ? HIGHLIGHT : '#CBD9C6'}
                strokeWidth={shelf.target ? 1 : 0.5}
                style={
                  shelf.target
                    ? { animation: 'wa-target 1.6s ease-in-out infinite' }
                    : undefined
                }
              />
              <text
                x={shelf.x + shelf.w / 2}
                y={shelf.y + shelf.h / 2}
                fontSize="8"
                fontWeight="bold"
                fill={shelf.target ? '#fff' : '#4A5E50'}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {shelf.code}
              </text>
            </motion.g>
          ))}

          {/* walking path: entrance → shelf B4 */}
          <motion.path
            variants={pathVariant}
            d="M 100 120 V 96 H 88 V 82"
            fill="none"
            stroke="var(--brand-green)"
            strokeWidth="2"
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
          {/* entrance marker */}
          <motion.g custom={SHELVES.length} variants={shelfVariant}>
            <rect x="88" y="118" width="24" height="4" rx="2" fill="#C9B892" />
            <circle cx="100" cy="120" r="3.5" fill="var(--brand-green)" />
          </motion.g>
        </svg>
      </motion.div>

      <motion.span
        variants={captionVariant}
        className="text-center font-mono text-[#566058] text-xs"
      >
        {mapCaption}
      </motion.span>
    </motion.div>
  );
}
