'use client';

interface AnimatedBearProps {
  size?: number;
}

/**
 * Animated 找货熊 mascot — a short looping idle clip (public/bear-idle.mp4,
 * ported from wherebear). The clip's white background is blended away with
 * `multiply` like the static <BearFace>, so the same light-surface-only rule
 * applies. Muted + autoplay + playsInline loops silently inline on mobile;
 * globals.css hides WebKit's overlay play button for it. Decorative only.
 */
export function AnimatedBear({ size = 96 }: AnimatedBearProps) {
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
