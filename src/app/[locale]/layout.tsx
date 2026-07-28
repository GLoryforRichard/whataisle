import { Analytics } from '@/analytics/analytics';
import {
  fontBricolageGrotesque,
  fontNotoSans,
  fontNotoSansMono,
  fontNotoSansSC,
  fontNotoSerif,
  fontQuicksand,
} from '@/assets/fonts';
import { PalettePicker } from '@/components/dev/palette-picker';
import { TailwindIndicator } from '@/components/layout/tailwind-indicator';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { type Locale, NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { Providers } from './providers';

import '@/styles/globals.css';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
}

/**
 * 1. Locale Layout
 * https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing#layout
 *
 * 2. NextIntlClientProvider
 * https://next-intl.dev/docs/usage/configuration#nextintlclientprovider
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enable static rendering for this layout
  // https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing#static-rendering
  setRequestLocale(locale);

  return (
    <html suppressHydrationWarning lang={locale}>
      <body
        className={cn(
          'size-full font-sans antialiased',
          fontQuicksand.variable,
          fontNotoSansSC.variable,
          fontNotoSans.variable,
          fontNotoSerif.variable,
          fontNotoSansMono.variable,
          fontBricolageGrotesque.variable
        )}
      >
        <NuqsAdapter>
          <NextIntlClientProvider>
            <Providers>
              {children}

              <Toaster richColors position="top-right" offset={64} />
              <TailwindIndicator />
              {/* Palette try-on: dev-only (never in E2E — a fixed overlay
                  would flake bottom-anchored assertions); set
                  NEXT_PUBLIC_PALETTE_PREVIEW=true to demo a prod build. */}
              {((process.env.NODE_ENV === 'development' &&
                process.env.NEXT_PUBLIC_E2E_TEST_MODE !== 'true') ||
                process.env.NEXT_PUBLIC_PALETTE_PREVIEW === 'true') && (
                <PalettePicker />
              )}
              <Analytics />
            </Providers>
          </NextIntlClientProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
