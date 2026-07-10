'use client';

import { motion } from 'motion/react';
import type { Variants } from 'motion/react';

/**
 * Step 01 visual: a casual shelf photo gets a camera flash, then AI bounding
 * boxes draw around products and multilingual name labels pop in. Plays once
 * when scrolled into view.
 */

const PRODUCTS: Array<{
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}> = [
  // top row (jars & bottles)
  { x: 22, y: 30, w: 20, h: 40, fill: '#C0392B' },
  { x: 46, y: 34, w: 20, h: 36, fill: '#A93226' },
  { x: 78, y: 26, w: 18, h: 44, fill: '#D4AC0D' },
  { x: 104, y: 34, w: 22, h: 36, fill: '#7D6608' },
  { x: 140, y: 30, w: 24, h: 40, fill: '#1E8449' },
  { x: 176, y: 36, w: 18, h: 34, fill: '#148F77' },
  // middle row (packs)
  { x: 24, y: 104, w: 30, h: 36, fill: '#2E86C1' },
  { x: 64, y: 100, w: 26, h: 40, fill: '#884EA0' },
  { x: 124, y: 100, w: 24, h: 40, fill: '#CB4335' },
  { x: 152, y: 104, w: 22, h: 36, fill: '#B03A2E' },
  { x: 200, y: 102, w: 30, h: 38, fill: '#239B56' },
  // bottom row (boxes)
  { x: 30, y: 172, w: 34, h: 32, fill: '#AF601A' },
  { x: 74, y: 176, w: 28, h: 28, fill: '#935116' },
  { x: 152, y: 170, w: 30, h: 34, fill: '#5B2C6F' },
  { x: 216, y: 170, w: 36, h: 34, fill: '#186A3B' },
];

const BOXES: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 16, y: 24, w: 56, h: 52 },
  { x: 118, y: 94, w: 62, h: 52 },
  { x: 210, y: 164, w: 48, h: 46 },
];

// Label pill positions as percentages of the photo area.
const LABEL_POS: Array<React.CSSProperties> = [
  { left: '4%', top: '2%' },
  { left: '38%', top: '68%' },
  { left: '48%', bottom: '3%' },
];

const cardVariant: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const flashVariant: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: [0, 0.75, 0],
    transition: { delay: 0.5, duration: 0.5, times: [0, 0.3, 1] },
  },
};

const boxVariant: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: { delay: 1 + i * 0.3, duration: 0.5, ease: 'easeOut' },
  }),
};

const labelVariant: Variants = {
  hidden: { opacity: 0, scale: 0.8, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      delay: 1.4 + i * 0.3,
      type: 'spring',
      stiffness: 300,
      damping: 20,
    },
  }),
};

const chipVariant: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: 2.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

interface ShelfScanVisualProps {
  labels: [string, string, string];
  foundChip: string;
}

export function ShelfScanVisual({ labels, foundChip }: ShelfScanVisualProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      variants={cardVariant}
      aria-hidden="true"
      className="w-full max-w-[380px] rounded-[20px] border border-[#EAE3D2] bg-white p-4 shadow-[0_1px_2px_rgba(15,53,44,0.04),0_14px_30px_rgba(15,53,44,0.06)]"
    >
      <div className="relative overflow-hidden rounded-[14px]">
        {/* Shelf "photo" */}
        <svg
          viewBox="0 0 280 224"
          className="block h-auto w-full"
          role="presentation"
        >
          <defs>
            <linearGradient id="wa-shelf-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F3EAD8" />
              <stop offset="100%" stopColor="#E6D9BF" />
            </linearGradient>
          </defs>
          <rect width="280" height="224" fill="url(#wa-shelf-bg)" />
          {/* shelf boards */}
          {[70, 140, 204].map((y) => (
            <rect
              key={y}
              x="0"
              y={y}
              width="280"
              height="7"
              rx="1"
              fill="#C9B892"
            />
          ))}
          {/* products */}
          {PRODUCTS.map((product) => (
            <rect
              key={`${product.x}-${product.y}`}
              x={product.x}
              y={product.y}
              width={product.w}
              height={product.h}
              rx="4"
              fill={product.fill}
              opacity="0.85"
            />
          ))}
          {/* blurred face — privacy cue */}
          <g className="blur-[3px]" opacity="0.7">
            <circle cx="252" cy="42" r="13" fill="#B9A58C" />
            <rect x="238" y="56" width="28" height="16" rx="6" fill="#8E9BAA" />
          </g>
          {/* AI bounding boxes */}
          {BOXES.map((box, i) => (
            <motion.rect
              key={`${box.x}-${box.y}`}
              custom={i}
              variants={boxVariant}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx="6"
              fill="none"
              stroke="var(--brand-lime)"
              strokeWidth="3"
            />
          ))}
        </svg>

        {/* camera flash */}
        <motion.div
          variants={flashVariant}
          className="pointer-events-none absolute inset-0 bg-white"
        />

        {/* product name labels */}
        {labels.map((label, i) => (
          <motion.span
            key={label}
            custom={i}
            variants={labelVariant}
            className="absolute rounded-full bg-white px-2.5 py-1 font-semibold text-[11px] text-[var(--brand-ink)] shadow-[0_4px_12px_rgba(15,53,44,0.18)]"
            style={LABEL_POS[i]}
          >
            {label}
          </motion.span>
        ))}
      </div>

      <motion.div variants={chipVariant} className="mt-3 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 font-semibold text-[var(--brand-lime)] text-xs">
          <span className="size-1.5 rounded-full bg-[var(--brand-lime)]" />
          {foundChip}
        </span>
      </motion.div>
    </motion.div>
  );
}
