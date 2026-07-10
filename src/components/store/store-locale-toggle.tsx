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

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label="Switch language"
      className="inline-flex h-9 min-w-14 items-center justify-center rounded-full border border-[var(--brand-cream)]/30 bg-transparent px-3.5 font-semibold text-[var(--brand-cream)] text-sm transition-colors hover:border-[var(--brand-lime)] hover:text-[var(--brand-lime)] disabled:opacity-60"
    >
      {t('header.languageToggle')}
    </button>
  );
}
