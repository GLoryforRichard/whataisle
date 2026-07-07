import { LocaleLink } from '@/i18n/navigation';
import { constructMetadata } from '@/lib/metadata';
import { CameraIcon, MapPinIcon, SparklesIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

/**
 * https://next-intl.dev/docs/environments/actions-metadata-route-handlers#metadata-api
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata | undefined> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    locale,
    pathname: '',
  });
}

interface HomePageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'HomePage' });

  const steps = [
    {
      icon: CameraIcon,
      title: t('how.snapTitle'),
      description: t('how.snapDescription'),
    },
    {
      icon: SparklesIcon,
      title: t('how.growTitle'),
      description: t('how.growDescription'),
    },
    {
      icon: MapPinIcon,
      title: t('how.findTitle'),
      description: t('how.findDescription'),
    },
  ];

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-24 pb-16 text-center">
        <span className="rounded-full border px-4 py-1 text-muted-foreground text-sm">
          {t('hero.badge')}
        </span>
        <h1 className="text-balance font-bold text-4xl tracking-tight md:text-6xl">
          {t('hero.title')}
        </h1>
        <p className="max-w-2xl text-balance text-lg text-muted-foreground">
          {t('hero.description')}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LocaleLink
            href="/auth/register"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('hero.primaryCta')}
          </LocaleLink>
          <LocaleLink
            href="#how-it-works"
            className="inline-flex h-12 items-center justify-center rounded-md border px-8 font-medium hover:bg-accent"
          >
            {t('hero.secondaryCta')}
          </LocaleLink>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-5xl px-4 pb-24">
        <h2 className="mb-10 text-center font-semibold text-3xl">
          {t('how.title')}
        </h2>
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="flex flex-col items-center gap-3 rounded-xl border p-8 text-center"
            >
              <step.icon className="size-8 text-primary" aria-hidden />
              <h3 className="font-semibold text-xl">{step.title}</h3>
              <p className="text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
