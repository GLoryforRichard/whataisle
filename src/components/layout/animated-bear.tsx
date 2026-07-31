'use client';

import { BearFace } from '@/components/layout/bear-face';
import { useEffect, useState } from 'react';

interface AnimatedBearProps {
  size?: number;
}

/**
 * Animated 找货熊 mascot — a short looping idle clip (public/bear-idle.mp4,
 * ported from wherebear). The clip's white background is blended away with
 * `multiply` like the static <BearFace>, so the same light-surface-only rule
 * applies. Muted + autoplay + playsInline loops silently inline on mobile;
 * globals.css hides WebKit's overlay play button for it. Decorative only.
 * The global reduced-motion CSS can't stop a <video>, so users who prefer
 * reduced motion get the static <BearFace> instead (SSR renders the static
 * bear too, then upgrades after hydration — never the reverse).
 */
export function AnimatedBear({ size = 96 }: AnimatedBearProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!animate) {
    return <BearFace size={size} />;
  }

  return (
    <video
      src="/bear-idle.mp4"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        display: 'block',
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
      }}
    />
  );
}
