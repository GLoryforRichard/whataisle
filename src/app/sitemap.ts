import { getLocalePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { generateHreflangUrls } from '@/lib/hreflang';
import type { MetadataRoute } from 'next';
import type { Locale } from 'next-intl';
import { getBaseUrl } from '@/lib/urls';

type Href = Parameters<typeof getLocalePathname>[0]['href'];

/**
 * Every public route the marketing site actually serves. Keep this list in
 * sync with src/app/[locale]/(marketing) — advertising a URL that 404s is
 * worse than omitting it.
 */
const staticRoutes = [
  '/',
  '/pricing',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/cookie',
  '/auth/login',
  '/auth/register',
];

/**
 * Generate a sitemap for the website with hreflang support
 *
 * https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps
 * https://github.com/javayhu/cnblocks/blob/main/app/sitemap.ts
 * https://ahrefs.com/blog/hreflang-tags/
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sitemapList: MetadataRoute.Sitemap = []; // final result

  // add static routes
  sitemapList.push(
    ...staticRoutes.flatMap((route) => {
      return routing.locales.map((locale) => ({
        url: getUrl(route, locale),
        alternates: {
          languages: generateHreflangUrls(route),
        },
      }));
    })
  );

  return sitemapList;
}

function getUrl(href: Href, locale: Locale) {
  const pathname = getLocalePathname({ locale, href });
  return getBaseUrl() + pathname;
}
