import Container from '@/components/layout/container';
import { AnswerMapVisual } from '@/components/marketing/home/answer-map-visual';
import { MemoryGridVisual } from '@/components/marketing/home/memory-grid-visual';
import { SearchWaysVisual } from '@/components/marketing/home/search-ways-visual';
import { ShelfScanVisual } from '@/components/marketing/home/shelf-scan-visual';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import { LocaleLink } from '@/i18n/navigation';
import { constructMetadata } from '@/lib/metadata';
import { cn } from '@/lib/utils';
import { ArrowRightIcon, MapPinIcon, QrCodeIcon } from 'lucide-react';
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

  const faqItems = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => ({
    question: t(`seo.faq.q${n}`),
    answer: t(`seo.faq.a${n}`),
  }));

  const exampleQuestions = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const).map(
    (n) => t(`seo.examples.q${n}`)
  );

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

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

      {/* ── How it works — story steps (static copy, animated visuals) ── */}
      <section id="how-it-works" className="pt-12 pb-12 sm:pt-16">
        <Container className="px-3 sm:px-4">
          <div className="mb-10 flex items-baseline justify-between sm:mb-14">
            <h2 className="font-bold text-3xl text-foreground">
              {t('story.title')}
            </h2>
            <span className="font-mono text-muted-foreground text-xs">04</span>
          </div>

          <div className="flex flex-col gap-16 sm:gap-24">
            <StoryStep
              step="01"
              title={t('story.snap.title')}
              description={t('story.snap.description')}
            >
              <ShelfScanVisual
                labels={[
                  t('story.snap.label1'),
                  t('story.snap.label2'),
                  t('story.snap.label3'),
                ]}
                foundChip={t('story.snap.foundChip')}
              />
            </StoryStep>

            <StoryStep
              step="02"
              title={t('story.memory.title')}
              description={t('story.memory.description')}
              reverse
            >
              <MemoryGridVisual
                count={128}
                counterLabel={t('story.memory.counterLabel')}
                newBadge={t('story.memory.newBadge')}
              />
            </StoryStep>

            <StoryStep
              step="03"
              title={t('story.ask.title')}
              description={t('story.ask.description')}
            >
              <SearchWaysVisual
                typedQuery={t('story.ask.typedQuery')}
                voiceLabel={t('story.ask.voiceLabel')}
                photoLabel={t('story.ask.photoLabel')}
              />
            </StoryStep>

            <StoryStep
              step="04"
              title={t('story.answer.title')}
              description={t('story.answer.description')}
              reverse
            >
              <AnswerMapVisual
                demoAsked={t('story.answer.demoAsked')}
                demoAnswer={t('story.answer.demoAnswer')}
                mapCaption={t('story.answer.mapCaption')}
              />
            </StoryStep>
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
            <ScrollReveal className="flex items-center justify-center p-8">
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
            </ScrollReveal>
          </div>
        </Container>
      </section>

      {/* ── "What aisle?" explained — static SEO copy + FAQ ── */}
      <section id="what-aisle" className="pb-20 sm:pb-24">
        <Container className="px-3 sm:px-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-12">
            <div className="flex flex-col gap-4">
              <h2 className="text-balance font-bold text-3xl text-foreground">
                {t('seo.title')}
              </h2>
              <p className="text-[#566058] leading-relaxed">
                {t('seo.intro1')}
              </p>
              <p className="text-[#566058] leading-relaxed">
                {t('seo.intro2')}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                {t('seo.examples.title')}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {exampleQuestions.map((question) => (
                  <li
                    key={question}
                    className="rounded-full border border-[#EAE3D2] bg-white px-3.5 py-1.5 text-[#40483F] text-sm"
                  >
                    {question}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {t('seo.owners.title')}
                </h3>
                <p className="text-[#566058] leading-relaxed">
                  {t('seo.owners.p1')}
                </p>
                <p className="text-[#566058] leading-relaxed">
                  {t('seo.owners.p2')}
                </p>
                <p className="text-[#566058] leading-relaxed">
                  {t('seo.owners.p3')}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {t('seo.shoppers.title')}
                </h3>
                <p className="text-[#566058] leading-relaxed">
                  {t('seo.shoppers.p1')}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {t('seo.multilingual.title')}
                </h3>
                <p className="text-[#566058] leading-relaxed">
                  {t('seo.multilingual.p1')}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <h2 className="font-bold text-3xl text-foreground">
                {t('seo.faq.title')}
              </h2>
              <div className="flex flex-col gap-4">
                {faqItems.map((item) => (
                  <div
                    key={item.question}
                    className="rounded-[20px] border border-[#EAE3D2] bg-white p-6 shadow-[0_1px_2px_rgba(15,53,44,0.04)]"
                  >
                    <h3 className="mb-2 font-bold text-[var(--brand-ink)] text-base">
                      {item.question}
                    </h3>
                    <p className="text-[#566058] text-sm leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[#566058] leading-relaxed">{t('seo.outro')}</p>
          </div>
        </Container>
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from our own translation strings
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      </section>
    </div>
  );
}

/**
 * One story step: server-rendered static copy (crawler-visible, no hidden
 * text) beside a client visual that animates once on viewport entry.
 */
function StoryStep({
  step,
  title,
  description,
  reverse = false,
  children,
}: {
  step: string;
  title: string;
  description: string;
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div
        className={cn(
          'flex flex-col items-start gap-4',
          reverse && 'lg:order-2'
        )}
      >
        <span className="rounded-full bg-[rgba(15,76,63,0.08)] px-3 py-1 font-bold font-mono text-[#2E5A2A] text-xs tracking-[0.1em]">
          {step}
        </span>
        <h3 className="text-balance font-bold text-2xl text-[var(--brand-ink)] sm:text-3xl">
          {title}
        </h3>
        <p className="max-w-md text-[#566058] leading-relaxed">{description}</p>
      </div>
      <div
        className={cn(
          'flex justify-center lg:justify-self-center',
          reverse && 'lg:order-1'
        )}
      >
        {children}
      </div>
    </div>
  );
}
