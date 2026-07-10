'use client';

import { motion } from 'motion/react';
import type { Variants } from 'motion/react';
import { AnimatedCounter } from './animated-counter';

/**
 * Step 02 visual: product tiles cascade into a grid while a counter counts up
 * — the store memory growing. The last tile arrives with a lime "new" flash.
 * Plays once when scrolled into view.
 */

const TILES: Array<{ emoji: string; shelf: string }> = [
  { emoji: '🌶️', shelf: 'B4' },
  { emoji: '🍜', shelf: 'A2' },
  { emoji: '🥫', shelf: 'C1' },
  { emoji: '🍚', shelf: 'D3' },
  { emoji: '🧄', shelf: 'A1' },
  { emoji: '🍪', shelf: 'C2' },
  { emoji: '🧋', shelf: 'B2' },
  { emoji: '🥟', shelf: 'D1' },
  { emoji: '🍵', shelf: 'A3' },
  { emoji: '🧂', shelf: 'B1' },
  { emoji: '🍤', shelf: 'C4' },
];

const NEW_TILE = { emoji: '🍯', shelf: 'B4' };

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.3 } },
};

const headerVariant: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const tileVariant: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 22 },
  },
};

const ringVariant: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: [0, 1, 0.4, 1],
    transition: { delay: 1.4, duration: 1.2, times: [0, 0.3, 0.6, 1] },
  },
};

interface MemoryGridVisualProps {
  count: number;
  counterLabel: string;
  newBadge: string;
}

export function MemoryGridVisual({
  count,
  counterLabel,
  newBadge,
}: MemoryGridVisualProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      variants={container}
      aria-hidden="true"
      className="w-full max-w-[380px] rounded-[20px] border border-[#EAE3D2] bg-white p-5 shadow-[0_1px_2px_rgba(15,53,44,0.04),0_14px_30px_rgba(15,53,44,0.06)]"
    >
      <motion.div
        variants={headerVariant}
        className="mb-4 flex items-baseline gap-2"
      >
        <AnimatedCounter
          to={count}
          delay={0.3}
          className="font-bold text-4xl text-[var(--brand-green)] tabular-nums"
        />
        <span className="font-medium text-[#566058] text-sm">
          {counterLabel}
        </span>
      </motion.div>

      <div className="grid grid-cols-4 gap-2.5">
        {TILES.map((tile) => (
          <motion.div
            key={`${tile.emoji}-${tile.shelf}`}
            variants={tileVariant}
            className="flex flex-col items-center gap-1 rounded-xl bg-[#F7F4EC] px-1 py-2.5"
          >
            <span className="text-xl leading-none">{tile.emoji}</span>
            <span className="rounded bg-white px-1.5 font-bold font-mono text-[9px] text-[#4A5E50]">
              {tile.shelf}
            </span>
          </motion.div>
        ))}

        {/* Newest arrival — lime flash sells "the memory grows" */}
        <motion.div
          variants={tileVariant}
          className="relative flex flex-col items-center gap-1 rounded-xl bg-[#F1F7E8] px-1 py-2.5"
        >
          <motion.span
            variants={ringVariant}
            className="pointer-events-none absolute inset-0 rounded-xl border-2 border-[var(--brand-lime)]"
          />
          <motion.span
            variants={ringVariant}
            className="-top-2 -right-2 absolute whitespace-nowrap rounded-full bg-[var(--brand-lime)] px-1.5 py-0.5 font-bold text-[9px] text-[var(--brand-green)] shadow-sm"
          >
            {newBadge}
          </motion.span>
          <span className="text-xl leading-none">{NEW_TILE.emoji}</span>
          <span className="rounded bg-white px-1.5 font-bold font-mono text-[9px] text-[#4A5E50]">
            {NEW_TILE.shelf}
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
}
