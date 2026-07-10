import Container from '@/components/layout/container';
import { LocaleLink } from '@/i18n/navigation';
import { constructMetadata } from '@/lib/metadata';
import {
  ArrowRightIcon,
  CameraIcon,
  MapPinIcon,
  QrCodeIcon,
  SparklesIcon,
} from 'lucide-react';
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
      n: '01',
      icon: CameraIcon,
      title: t('how.snapTitle'),
      description: t('how.snapDescription'),
    },
    {
      n: '02',
      icon: SparklesIcon,
      title: t('how.growTitle'),
      description: t('how.growDescription'),
    },
    {
      n: '03',
      icon: MapPinIcon,
      title: t('how.findTitle'),
      description: t('how.findDescription'),
    },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Hero — detached rounded card floating on the cream page ── */}
      <section className="pt-3 sm:pt-4">
        <Container className="px-3 sm:px-4">
          <div className="relative overflow-hidden rounded-[28px] bg-[var(--brand-green)] text-[var(--brand-cream)] shadow-[0_18px_44px_rgba(15,53,44,0.16)]">
            <div className="grid grid-cols-1 items-center gap-10 px-6 py-12 sm:px-10 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:px-14 lg:py-16">
              <div className="wa-fade-up flex flex-col items-start gap-6">
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-lime)]/40 bg-[var(--brand-lime)]/15 px-3.5 py-1.5 font-semibold text-[var(--brand-lime)] text-sm">
                  <MapPinIcon className="size-3.5" aria-hidden />
                  {t('hero.badge')}
                </span>
                <h1 className="text-balance font-bold text-4xl leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                  {t('hero.title')}
                </h1>
                <p className="max-w-xl text-pretty text-[var(--brand-cream)]/75 text-lg leading-relaxed">
                  {t('hero.description')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3.5">
                  <LocaleLink
                    href="/auth/register"
                    className="inline-flex h-14 items-center gap-2 rounded-full bg-[var(--brand-lime)] px-7 font-bold text-[var(--brand-green)] text-lg shadow-[0_10px_26px_rgba(198,242,78,0.28)] transition-transform hover:bg-[var(--brand-lime-hover)] active:scale-[0.97]"
                  >
                    {t('hero.primaryCta')}
                    <ArrowRightIcon className="size-5" aria-hidden />
                  </LocaleLink>
                  <LocaleLink
                    href="#how-it-works"
                    className="inline-flex h-14 items-center rounded-full border-[1.5px] border-[var(--brand-cream)]/35 px-6 font-semibold text-[var(--brand-cream)] transition-colors hover:border-[var(--brand-lime)]"
                  >
                    {t('hero.secondaryCta')}
                  </LocaleLink>
                </div>
              </div>

              {/* Hero visual — phone-answer mock + floating badge */}
              <div
                className="wa-fade-up relative mx-auto flex items-center justify-center"
                aria-hidden="true"
              >
                <div className="absolute size-72 rounded-full bg-[radial-gradient(closest-side,rgba(198,242,78,0.22),transparent_70%)]" />
                <div className="-rotate-3 relative w-[250px] rounded-[30px] bg-[var(--brand-cream)] p-4 shadow-[0_26px_60px_rgba(0,0,0,0.35)]">
                  <div className="overflow-hidden rounded-[20px] border border-[#E4DECB]">
                    <div className="flex items-center justify-between bg-[var(--brand-green)] px-3.5 py-3">
                      <span className="font-bold text-[var(--brand-cream)] text-[13px]">
                        {t('hero.demoStore')}
                      </span>
                      <span className="text-[11px] text-[var(--brand-lime)]">
                        中/EN
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 bg-white p-3.5">
                      <div className="text-[11px] text-[#566058]">
                        {t('hero.demoAsked')}
                      </div>
                      <div className="flex items-center gap-2.5 rounded-xl border border-[#D8EBB4] bg-[#F1F7E8] p-2.5">
                        <div className="flex size-11 items-center justify-center rounded-[10px] bg-[var(--brand-lime)] font-bold text-[var(--brand-green)] text-xl">
                          B4
                        </div>
                        <div className="font-semibold text-[#12352C] text-xs leading-snug">
                          {t('hero.demoAnswer')}
                        </div>
                      </div>
                      <div className="h-2 w-[90%] rounded bg-[#EEF0EA]" />
                      <div className="h-2 w-[70%] rounded bg-[#EEF0EA]" />
                    </div>
                  </div>
                </div>
                <div className="wa-float absolute right-6 bottom-3 flex items-center gap-1.5 rounded-2xl bg-[var(--brand-lime)] px-3.5 py-2.5 font-bold text-[var(--brand-green)] shadow-[0_12px_24px_rgba(15,53,44,0.25)]">
                  <MapPinIcon className="size-4" aria-hidden />
                  15s
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="pt-12 pb-12 sm:pt-16">
        <Container className="px-3 sm:px-4">
          <div className="mb-7 flex items-baseline justify-between">
            <h2 className="font-bold text-3xl text-foreground">
              {t('how.title')}
            </h2>
            <span className="font-mono text-muted-foreground text-xs">03</span>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.title}
                className="relative flex flex-col gap-3.5 rounded-[20px] border border-[#EAE3D2] bg-white p-7 shadow-[0_1px_2px_rgba(15,53,44,0.04),0_14px_30px_rgba(15,53,44,0.06)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[#F1F7E8]">
                    <step.icon
                      className="size-6 text-[var(--brand-green)]"
                      aria-hidden
                    />
                  </div>
                  <span className="font-bold text-4xl text-[#E7EFD9] leading-none">
                    {step.n}
                  </span>
                </div>
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {step.title}
                </h3>
                <p className="text-[#566058] leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Scan band (lime) ── */}
      <section className="pb-24">
        <Container className="px-3 sm:px-4">
          <div className="grid grid-cols-1 overflow-hidden rounded-3xl bg-[var(--brand-lime)] md:grid-cols-[1.2fr_0.8fr]">
            <div className="flex flex-col items-start gap-4 p-8 md:p-10">
              <span className="rounded-full bg-[rgba(15,76,63,0.1)] px-3 py-1 font-mono font-bold text-[#2E5A2A] text-xs tracking-[0.1em]">
                {t('scan.tag')}
              </span>
              <h2 className="text-balance font-bold text-3xl text-[var(--brand-green)] leading-tight">
                {t('scan.title')}
              </h2>
              <p className="max-w-md text-[#2E4A3E] leading-relaxed">
                {t('scan.sub')}
              </p>
              <LocaleLink
                href="/auth/register"
                className="mt-1 inline-flex h-13 items-center gap-2 rounded-full bg-[var(--brand-green)] px-6 py-3.5 font-bold text-[var(--brand-lime)] transition-transform hover:bg-[var(--brand-green-hover)] active:scale-[0.97]"
              >
                <QrCodeIcon className="size-[18px]" aria-hidden />
                {t('scan.cta')}
              </LocaleLink>
            </div>
            <div className="flex items-center justify-center p-8">
              <div className="flex rotate-2 flex-col items-center gap-3 rounded-2xl bg-white p-5 shadow-[0_16px_34px_rgba(15,53,44,0.18)]">
                <div
                  className="flex size-[132px] items-center justify-center rounded-xl bg-[var(--brand-green)] bg-[repeating-linear-gradient(45deg,rgba(198,242,78,0.28)_0,rgba(198,242,78,0.28)_7px,transparent_7px,transparent_14px)]"
                  aria-hidden
                >
                  <QrCodeIcon className="size-11 text-[var(--brand-lime)]" />
                </div>
                <span className="font-mono text-[#566058] text-xs">
                  {t('scan.caption')}
                </span>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
