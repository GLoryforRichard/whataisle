'use client';

import { websiteConfig } from '@/config/website';
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useLocaleStore } from '@/stores/locale-store';
import { type Locale, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useTransition } from 'react';

interface LocaleSwitcherProps {
  /**
   * 'dark' sits on the dark-green navbar; 'light' sits on light surfaces
   * such as the dashboard header.
   */
  variant?: 'dark' | 'light';
}

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
export function LocaleSwitcher({ variant = 'dark' }: LocaleSwitcherProps) {
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
    <div
      className={cn(
        'flex h-9 shrink-0 items-center gap-0.5 rounded-full border p-0.5',
        variant === 'dark' ? 'border-[var(--brand-cream)]/30' : 'border-border'
      )}
    >
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
              variant === 'dark' &&
                (isActive
                  ? 'bg-[var(--brand-lime)] text-[var(--brand-green)]'
                  : 'text-[var(--brand-cream)]/85 hover:text-[var(--brand-lime)]'),
              variant === 'light' &&
                (isActive
                  ? 'bg-[var(--brand-green)] text-[var(--brand-cream)]'
                  : 'text-muted-foreground hover:text-foreground')
            )}
          >
            {localeOption === 'zh' ? '中文' : localeOption.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
