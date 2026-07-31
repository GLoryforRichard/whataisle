'use client';

import { websiteConfig } from '@/config/website';
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useLocaleStore } from '@/stores/locale-store';
import { type Locale, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/**
 * LocaleSwitcher component
 *
 * A text-first "中文 | EN" segmented control. The previous icon-only
 * dropdown was effectively invisible to the target audience (45-60 year
 * old store owners), so the language names themselves are the control.
 *
 * Based on next-intl's useLocaleRouter and useLocalePathname for locale
 * navigation, which also persist the choice in the NEXT_LOCALE cookie.
 * https://next-intl.dev/docs/routing/navigation#userouter
 */
export function LocaleSwitcher() {
  const router = useLocaleRouter();
  const pathname = useLocalePathname();
  const params = useParams();
  const locale = useLocale();
  const { setCurrentLocale } = useLocaleStore();
  const [, startTransition] = useTransition();

  useEffect(() => {
    setCurrentLocale(locale);
  }, [locale, setCurrentLocale]);

  // Hide when there is only one locale available. Checked after the hooks
  // above so the hook order stays stable across renders.
  const locales = Object.keys(websiteConfig.i18n.locales);
  if (locales.length <= 1) {
    return null;
  }

  const setLocale = (nextLocale: Locale) => {
    if (nextLocale === locale) {
      return;
    }
    setCurrentLocale(nextLocale);

    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: nextLocale }
      );
    });
  };

  return (
    // No group role needed: each button's visible label (中文 / EN) is its
    // accessible name, and aria-pressed marks the active one.
    // Wherebear language pill: white capsule, 1px ink border; the ACTIVE
    // segment fills orange with bold white glyphs (documented white-on-orange
    // exception #3). Every mount now sits on a light surface (the nav is
    // cream), so the old dark/light variant prop is gone.
    <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-foreground bg-white p-0.5">
      {locales.map((localeOption) => {
        const isActive = localeOption === locale;
        return (
          <button
            key={localeOption}
            type="button"
            aria-pressed={isActive}
            onClick={() => setLocale(localeOption)}
            className={cn(
              'h-full cursor-pointer rounded-full px-3 font-semibold text-base transition-colors',
              isActive
                ? 'bg-[var(--brand)] font-bold text-[var(--brand-paper)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {localeOption === 'zh' ? '中文' : localeOption.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
