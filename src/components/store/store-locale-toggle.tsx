'use client';

import { Button } from '@/components/ui/button';
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
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={isPending}
      aria-label="Switch language"
      className="min-w-14 font-medium"
    >
      {t('header.languageToggle')}
    </Button>
  );
}
