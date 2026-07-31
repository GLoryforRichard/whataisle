import { Button } from '@react-email/components';
import React, { type PropsWithChildren } from 'react';

/**
 * Bear sticker CTA in email-safe form: orange fill, INK text (the palette
 * rule — white-on-orange fails contrast), hard ink border + offset shadow.
 * Outlook strips border-radius and box-shadow; it degrades to a flat
 * bordered orange button, which is fine.
 */
export default function EmailButton({
  href,
  children,
}: PropsWithChildren<{
  href: string;
}>) {
  return (
    <Button
      href={href}
      className="rounded-[12px] bg-[#ff8a00] px-5 py-2.5 font-bold text-[#111111]"
      style={{ border: '2px solid #111111', boxShadow: '4px 4px 0 #111111' }}
    >
      {children}
    </Button>
  );
}
