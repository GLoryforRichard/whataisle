import { cn } from '@/lib/utils';

interface BearFaceProps {
  size?: number;
  className?: string;
  /** Empty (default) marks the mascot decorative and hides it from AT. */
  alt?: string;
}

/**
 * 找货熊 mascot — the detective-bear mark (public/bear-flat.png, ported from
 * wherebear). The PNG has a white matte, not alpha; `multiply` blends it away
 * so the bear sits cleanly on cream/white/tint surfaces. NEVER place it on
 * orange or ink fills — multiply darkens the art into mud there (that is why
 * the footer is deep cream, not ink). Server-safe: plain <img>, no hooks.
 * Animated variant: <AnimatedBear>.
 */
export function BearFace({ size = 56, className, alt = '' }: BearFaceProps) {
  return (
    <img
      src="/bear-flat.png"
      alt={alt}
      aria-hidden={alt === '' || undefined}
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{
        display: 'block',
        objectFit: 'contain',
        mixBlendMode: 'multiply',
      }}
    />
  );
}
