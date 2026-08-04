import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { LocaleLink } from '@/i18n/navigation';
import { Routes } from '@/routes';
import { ArrowRightIcon, CreditCardIcon, MailIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Post-pivot dashboard: stores run as standalone per-store deployments that
 * the founder installs by hand, so there is nothing to self-serve here
 * anymore. The signed-in area exists for subscription management only —
 * this page just says so and points at billing and support.
 */
export default async function DashboardPage() {
  const t = await getTranslations('Dashboard.dashboard');

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }];

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className="flex flex-col gap-6 px-4 py-6 lg:px-6">
        <section className="rounded-xl border p-5">
          <h1 className="font-bold text-2xl">{t('welcomeTitle')}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {t('welcomeDescription')}
          </p>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <LocaleLink
            href={Routes.SettingsBilling}
            className="flex items-center gap-3 rounded-xl border p-5 hover:border-primary hover:bg-accent"
          >
            <CreditCardIcon className="size-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="font-semibold">{t('billingCard.title')}</p>
              <p className="text-muted-foreground text-sm">
                {t('billingCard.description')}
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0" aria-hidden />
          </LocaleLink>

          <LocaleLink
            href={Routes.Contact}
            className="flex items-center gap-3 rounded-xl border p-5 hover:border-primary hover:bg-accent"
          >
            <MailIcon className="size-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="font-semibold">{t('contactCard.title')}</p>
              <p className="text-muted-foreground text-sm">
                {t('contactCard.description')}
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0" aria-hidden />
          </LocaleLink>
        </section>
      </div>
    </>
  );
}
