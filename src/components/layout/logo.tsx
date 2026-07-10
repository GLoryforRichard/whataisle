import { cn } from '@/lib/utils';

/**
 * WhatAisle brand mark — Fresh Green (5a): a lime rounded-square chip holding a
 * dark-green shopping-cart glyph. Self-contained (works on light/dark, no theme
 * hook), so it renders in both server and client trees.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="WhatAisle logo"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[0.55rem]',
        'bg-[var(--brand-lime)]',
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#0F4C3F"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[60%]"
        aria-hidden="true"
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
    </span>
  );
}
