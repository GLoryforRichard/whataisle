'use client';

import { isDemoWebsite } from '@/lib/demo';
import { Routes } from '@/routes';
import type { NestedMenuItem } from '@/types';
import {
  ChartNoAxesCombinedIcon,
  CircleUserRoundIcon,
  CoinsIcon,
  DatabaseIcon,
  FilmIcon,
  KeyIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  MapIcon,
  MapPinnedIcon,
  PackageIcon,
  QrCodeIcon,
  Settings2Icon,
  SettingsIcon,
  StoreIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { websiteConfig } from './website';

/**
 * Get sidebar config with translations
 *
 * NOTICE: used in client components only
 *
 * docs:
 * https://mksaas.com/docs/config/sidebar
 *
 * @returns The sidebar config with translated titles and descriptions
 */
export function useSidebarLinks(): NestedMenuItem[] {
  const t = useTranslations('Dashboard');
  const mt = useTranslations('Manage');

  // if is demo website, allow user to access admin and user pages, but data is fake
  const isDemo = isDemoWebsite();

  return [
    {
      title: t('dashboard.title'),
      icon: <LayoutDashboardIcon className="size-4 shrink-0" />,
      href: Routes.Dashboard,
      external: false,
    },
    {
      title: mt('storeSection'),
      icon: <StoreIcon className="size-4 shrink-0" />,
      items: [
        {
          title: mt('shelves.nav'),
          icon: <PackageIcon className="size-4 shrink-0" />,
          href: Routes.ManageShelves,
          external: false,
        },
        {
          title: mt('insights.nav'),
          icon: <ChartNoAxesCombinedIcon className="size-4 shrink-0" />,
          href: Routes.ManageInsights,
          external: false,
        },
        {
          title: mt('video.nav'),
          icon: <FilmIcon className="size-4 shrink-0" />,
          href: Routes.ManageVideo,
          external: false,
        },
        {
          title: mt('map.nav'),
          icon: <MapIcon className="size-4 shrink-0" />,
          href: Routes.ManageMap,
          external: false,
        },
        {
          title: mt('posters.nav'),
          icon: <QrCodeIcon className="size-4 shrink-0" />,
          href: Routes.ManagePosters,
          external: false,
        },
        {
          title: mt('profile.nav'),
          icon: <StoreIcon className="size-4 shrink-0" />,
          href: Routes.ManageProfile,
          external: false,
        },
        {
          title: mt('export.nav'),
          icon: <DatabaseIcon className="size-4 shrink-0" />,
          href: Routes.ManageData,
          external: false,
        },
      ],
    },
    {
      title: t('admin.title'),
      icon: <SettingsIcon className="size-4 shrink-0" />,
      authorizeOnly: isDemo ? ['admin', 'user'] : ['admin'],
      items: [
        {
          title: t('admin.users.title'),
          icon: <UsersRoundIcon className="size-4 shrink-0" />,
          href: Routes.AdminUsers,
          external: false,
        },
        {
          title: mt('adminMapping.nav'),
          icon: <MapPinnedIcon className="size-4 shrink-0" />,
          href: Routes.AdminMapping,
          external: false,
        },
      ],
    },
    {
      title: t('settings.title'),
      icon: <Settings2Icon className="size-4 shrink-0" />,
      items: [
        {
          title: t('settings.profile.title'),
          icon: <CircleUserRoundIcon className="size-4 shrink-0" />,
          href: Routes.SettingsProfile,
          external: false,
        },
        ...(websiteConfig.credits.enableCredits
          ? [
              {
                title: t('settings.credits.title'),
                icon: <CoinsIcon className="size-4 shrink-0" />,
                href: Routes.SettingsCredits,
                external: false,
              },
            ]
          : []),
        ...(websiteConfig.apikeys.enable
          ? [
              {
                title: t('settings.apiKeys.title'),
                icon: <KeyIcon className="size-4 shrink-0" />,
                href: Routes.SettingsApiKeys,
                external: false,
              },
            ]
          : []),
        {
          title: t('settings.security.title'),
          icon: <LockKeyholeIcon className="size-4 shrink-0" />,
          href: Routes.SettingsSecurity,
          external: false,
        },
      ],
    },
  ];
}
