'use client';

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { useEffect, useRef } from 'react';

interface AnimatedCounterProps {
  to: number;
  className?: string;
  /** Seconds before the count-up starts once in view. */
  delay?: number;
}

/** Counts from 0 to `to` once the element scrolls into view. */
export function AnimatedCounter({
  to,
  className,
  delay = 0,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const reducedMotion = useReducedMotion();
  const value = useMotionValue(0);
  const rounded = useTransform(value, (v) => Math.round(v).toString());

  useEffect(() => {
    if (!isInView) return;
    if (reducedMotion) {
      value.set(to);
      return;
    }
    const controls = animate(value, to, {
      delay,
      duration: 1.2,
      ease: 'easeOut',
    });
    return () => controls.stop();
  }, [isInView, reducedMotion, to, delay, value]);

  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}
