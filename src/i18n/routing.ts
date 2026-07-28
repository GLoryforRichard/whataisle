import { websiteConfig } from '@/config/website';
import { defineRouting } from 'next-intl/routing';

export const DEFAULT_LOCALE = websiteConfig.i18n.defaultLocale;
export const LOCALES = Object.keys(websiteConfig.i18n.locales);

// The name of the cookie that is used to determine the locale
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

/**
 * Next.js internationalized routing
 *
 * https://next-intl.dev/docs/routing
 * https://github.com/amannn/next-intl/blob/main/examples/example-app-router/src/i18n/routing.ts
 */
export const routing = defineRouting({
  // A list of all locales that are supported
  locales: LOCALES,
  // Default locale when no locale matches
  defaultLocale: DEFAULT_LOCALE,
  // Resolve the locale from (in order) URL prefix, NEXT_LOCALE cookie, then
  // Accept-Language, so Chinese-system visitors land on /zh without hunting
  // for the switcher. Search bots send no zh Accept-Language and keep getting
  // the English page at /; hreflang alternates cover both locales.
  // https://next-intl.dev/docs/routing/middleware#locale-detection
  localeDetection: true,
  // Once a locale is detected, it will be remembered for future requests by
  // being stored in the NEXT_LOCALE cookie. next-intl's default cookie is
  // session-scoped; maxAge makes a manual language choice stick for a year.
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: 60 * 60 * 24 * 365,
  },
  // The prefix to use for the locale in the URL
  // https://next-intl.dev/docs/routing#locale-prefix
  localePrefix: 'as-needed',
});
