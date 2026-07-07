'use client';

import { Routes } from '@/routes';
import type { NestedMenuItem } from '@/types';
import { useTranslations } from 'next-intl';
import { websiteConfig } from './website';

/**
 * Get navbar config with translations
 *
 * NOTICE: used in client components only
 *
 * Kept deliberately flat: store owners should never face a mega-menu.
 *
 * @returns The navbar config with translated titles and descriptions
 */
export function useNavbarLinks(): NestedMenuItem[] {
  const t = useTranslations('Marketing.navbar');

  return [
    {
      title: t('howItWorks.title'),
      href: Routes.HowItWorks,
      external: false,
    },
    ...(websiteConfig.docs.enable
      ? [
          {
            title: t('docs.title'),
            href: Routes.Docs,
            external: false,
          },
        ]
      : []),
    {
      title: t('about.title'),
      href: Routes.About,
      external: false,
    },
    {
      title: t('contact.title'),
      href: Routes.Contact,
      external: false,
    },
  ];
}
