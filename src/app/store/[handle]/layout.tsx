import {
  fontBricolageGrotesque,
  fontNotoSans,
  fontNotoSansMono,
  fontNotoSerif,
} from '@/assets/fonts';
import { StoreHeader } from '@/components/store/store-header';
import { StoreNotFound } from '@/components/store/store-not-found';
import { cn } from '@/lib/utils';
import { getStoreByHandle } from '@/lib/store-context';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';

import '@/styles/globals.css';

interface StoreLayoutProps {
  children: ReactNode;
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const store = await getStoreByHandle(handle);
  return {
    title: store?.displayName ?? 'WhatAisle',
    // Store pages are phone-first; keep robots off until stores go live.
    robots: { index: false },
  };
}

/**
 * Root layout for store subdomains (<handle>.whataisle.com).
 *
 * Lives outside the [locale] segment: the locale comes from the NEXT_LOCALE
 * cookie (see src/i18n/request.ts), so shopper URLs stay clean.
 */
export default async function StoreLayout({
  children,
  params,
}: StoreLayoutProps) {
  const { handle } = await params;
  const locale = await getLocale();
  const store = await getStoreByHandle(handle);
  const active = store && store.status === 'active';

  return (
    <html suppressHydrationWarning lang={locale}>
      <body
        className={cn(
          'size-full antialiased',
          fontNotoSans.className,
          fontNotoSerif.variable,
          fontNotoSansMono.variable,
          fontBricolageGrotesque.variable
        )}
      >
        <NextIntlClientProvider>
          {active ? (
            <div className="flex min-h-screen flex-col">
              <StoreHeader
                displayName={
                  locale === 'zh' && store.displayNameZh
                    ? store.displayNameZh
                    : store.displayName
                }
                logoKey={store.logoKey}
              />
              <main className="flex-1">{children}</main>
              <StoreFooter />
            </div>
          ) : (
            <StoreNotFound />
          )}
          <Toaster richColors position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

async function StoreFooter() {
  const t = await getTranslations('Store');
  const mainSite =
    process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.whataisle.com';
  return (
    <footer className="border-t py-4 text-center">
      <a
        href={mainSite}
        className="text-muted-foreground text-sm hover:text-primary"
      >
        {t('footer.poweredBy')}
      </a>
    </footer>
  );
}
