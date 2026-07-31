'use client';

import { LOCALE_COOKIE_NAME } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * One-tap EN/中 toggle (requirements §9). Sets the NEXT_LOCALE cookie and
 * refreshes — store pages carry no locale in the URL.
 */
export function StoreLocaleToggle() {
  const t = useTranslations('Store');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = locale === 'zh' ? 'en' : 'zh';
    // biome-ignore lint/suspicious/noDocumentCookie: simple first-party cookie
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  // Wherebear language pill: white capsule with an ink border; the ACTIVE
  // segment fills orange with bold white glyphs (documented white-on-orange
  // exception #3 — two glyphs, bold, decorative-scale).
  const seg = 'rounded-full px-2.5 py-1 text-sm transition-colors';
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={t('header.languageToggle')}
      title={t('header.languageToggle')}
      className="inline-flex items-center rounded-full border border-foreground bg-white p-0.5 font-semibold disabled:opacity-60"
    >
      <span
        className={`${seg} ${locale === 'en' ? 'bg-[var(--brand)] font-bold text-[var(--brand-paper)]' : 'text-muted-foreground'}`}
      >
        EN
      </span>
      <span
        className={`${seg} ${locale === 'zh' ? 'bg-[var(--brand)] font-bold text-[var(--brand-paper)]' : 'text-muted-foreground'}`}
      >
        中
      </span>
    </button>
  );
}
