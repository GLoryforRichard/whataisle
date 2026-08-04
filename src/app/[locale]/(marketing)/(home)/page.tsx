import { BearFace } from '@/components/layout/bear-face';
import Container from '@/components/layout/container';
import { AnswerMapVisual } from '@/components/marketing/home/answer-map-visual';
import { MemoryGridVisual } from '@/components/marketing/home/memory-grid-visual';
import { SearchWaysVisual } from '@/components/marketing/home/search-ways-visual';
import { ShelfScanVisual } from '@/components/marketing/home/shelf-scan-visual';
import { HeroTryScan } from '@/components/marketing/home/try-scan-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import { websiteConfig } from '@/config/website';
import { LocaleLink } from '@/i18n/navigation';
import { constructMetadata } from '@/lib/metadata';
import { getStoreUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';
import { ArrowRightIcon, MapPinIcon, QrCodeIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import QRCode from 'qrcode';

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

  // Demo store: the "see it before you pay" surface. All three link sites
  // (hero CTA, scan-band QR, footer) disappear when the handle is unset.
  const demoStoreHandle = websiteConfig.demoStoreHandle;
  const demoStoreUrl = demoStoreHandle ? getStoreUrl(demoStoreHandle) : null;
  const demoQrDataUrl = demoStoreUrl
    ? await QRCode.toDataURL(demoStoreUrl, {
        width: 264,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
    : null;

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
      {/* ── Hero — ink text straight on the white page; the brand color
             lives only in the CTA, badge and small accents ── */}
      <section className="pt-10 sm:pt-14">
        <Container className="px-3 sm:px-4">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col items-start gap-6">
              {/* Bear badge — the wherebear hero mascot in a white sticker circle. */}
              <div
                className="wa-rise flex size-[112px] items-center justify-center overflow-hidden rounded-full border-2 border-foreground bg-card shadow-[4px_4px_0_#111]"
                aria-hidden
              >
                <BearFace size={104} />
              </div>
              <span
                className="wa-rise inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3.5 py-1.5 font-semibold text-[var(--chip-fg)] text-sm"
                style={{ animationDelay: '70ms' }}
              >
                <MapPinIcon className="size-3.5" aria-hidden />
                {t('hero.badge')}
              </span>
              <h1
                className="wa-display wa-rise text-balance font-bold text-4xl text-foreground leading-[1.1] sm:text-5xl lg:text-[3.25rem]"
                style={{ animationDelay: '140ms' }}
              >
                {t('hero.title')}
              </h1>
              <p
                className="wa-rise max-w-xl text-pretty text-lg text-muted-foreground leading-relaxed"
                style={{ animationDelay: '210ms' }}
              >
                {t('hero.description')}
              </p>
              <div
                className="wa-rise mt-1 flex flex-wrap items-center gap-3.5"
                style={{ animationDelay: '280ms' }}
              >
                <LocaleLink
                  href="/pricing"
                  className="inline-flex h-14 items-center gap-2 rounded-[16px] border-2 border-[var(--cta-border)] bg-[var(--cta-bg)] px-7 font-bold text-[var(--cta-fg)] text-lg shadow-[var(--cta-shadow)] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#111] active:translate-x-0 active:translate-y-0 active:shadow-[var(--cta-shadow)]"
                >
                  {t('hero.primaryCta')}
                  <ArrowRightIcon className="size-5" aria-hidden />
                </LocaleLink>
                {demoStoreUrl ? (
                  <a
                    href={demoStoreUrl}
                    className="inline-flex h-14 items-center rounded-[16px] border-2 border-foreground bg-card px-6 font-semibold text-foreground text-lg shadow-[4px_4px_0_#111] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#111] active:translate-x-0 active:translate-y-0 active:shadow-[4px_4px_0_#111]"
                  >
                    {t('hero.secondaryCta')}
                  </a>
                ) : (
                  <LocaleLink
                    href="#how-it-works"
                    className="inline-flex h-14 items-center rounded-[16px] border-2 border-foreground bg-card px-6 font-semibold text-foreground text-lg shadow-[4px_4px_0_#111] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#111] active:translate-x-0 active:translate-y-0 active:shadow-[4px_4px_0_#111]"
                  >
                    {t('hero.howItWorksCta')}
                  </LocaleLink>
                )}
              </div>
              {/* Price up front: this audience distrusts hidden pricing far
                  more than a big number (requirements §〇: 选诚实). */}
              <p
                className="wa-rise text-base text-muted-foreground"
                style={{ animationDelay: '350ms' }}
              >
                {t('hero.priceNote')}
              </p>
            </div>

            {/* Hero visual — live one-photo scan demo */}
            <HeroTryScan />
          </div>
        </Container>
      </section>

      {/* ── How it works — story steps (static copy, animated visuals) ── */}
      <section id="how-it-works" className="pt-12 pb-12 sm:pt-16">
        <Container className="px-3 sm:px-4">
          <h2 className="wa-display mb-10 font-bold text-3xl text-foreground sm:mb-14">
            {t('story.title')}
          </h2>

          <div className="flex flex-col gap-16 sm:gap-24">
            <StoryStep
              step={t('story.step', { n: 1 })}
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
              step={t('story.step', { n: 2 })}
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
              step={t('story.step', { n: 3 })}
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
              step={t('story.step', { n: 4 })}
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

      {/* ── Scan band — one of the page's few intentional tint blocks ── */}
      <section className="pb-24">
        <Container className="px-3 sm:px-4">
          <div className="grid grid-cols-1 overflow-hidden rounded-3xl border-2 border-[var(--band-border)] bg-[var(--band-bg)] md:grid-cols-[1.2fr_0.8fr]">
            <div className="flex flex-col items-start gap-4 p-8 md:p-10">
              <span className="rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3 py-1 font-bold text-[var(--chip-fg)] text-sm">
                {t('scan.tag')}
              </span>
              <h2 className="wa-display text-balance font-bold text-3xl text-foreground leading-tight">
                {t('scan.title')}
              </h2>
              <p className="max-w-md text-lg text-muted-foreground leading-relaxed">
                {t('scan.sub')}
              </p>
              <LocaleLink
                href="/contact"
                className="mt-1 inline-flex h-13 items-center gap-2 rounded-[16px] border-2 border-[var(--cta-border)] bg-[var(--cta-bg)] px-6 py-3.5 font-bold text-[var(--cta-fg)] shadow-[var(--cta-shadow)] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#111] active:translate-x-0 active:translate-y-0 active:shadow-[var(--cta-shadow)]"
              >
                <QrCodeIcon className="size-[18px]" aria-hidden />
                {t('scan.cta')}
              </LocaleLink>
            </div>
            <ScrollReveal className="flex items-center justify-center p-8">
              {demoStoreUrl && demoQrDataUrl ? (
                // A real, scannable QR into the demo store — proof beats
                // decoration for this audience.
                <a
                  href={demoStoreUrl}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-foreground bg-white p-5 shadow-[4px_4px_0_#111] transition-transform hover:scale-[1.02]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={demoQrDataUrl}
                    alt={t('scan.demoCaption')}
                    className="size-[132px] rounded-xl"
                  />
                  <span className="text-muted-foreground text-sm">
                    {t('scan.demoCaption')}
                  </span>
                </a>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground bg-white p-5 shadow-[4px_4px_0_#111]">
                  <div
                    className="flex size-[132px] items-center justify-center rounded-xl bg-[var(--brand)]"
                    aria-hidden
                  >
                    <QrCodeIcon className="size-11 text-[var(--brand-ink)]" />
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {t('scan.caption')}
                  </span>
                </div>
              )}
            </ScrollReveal>
          </div>
        </Container>
      </section>

      {/* ── "What aisle?" explained — static SEO copy + FAQ ── */}
      <section id="what-aisle" className="pb-20 sm:pb-24">
        <Container className="px-3 sm:px-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-12">
            <div className="flex flex-col gap-4">
              <h2 className="wa-display text-balance font-bold text-3xl text-foreground">
                {t('seo.title')}
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                {t('seo.intro1')}
              </p>
              <p className="text-muted-foreground text-lg leading-relaxed">
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
                    className="rounded-full border border-border bg-white px-4 py-2 text-foreground text-base"
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
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {t('seo.owners.p1')}
                </p>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {t('seo.owners.p2')}
                </p>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {t('seo.owners.p3')}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {t('seo.shoppers.title')}
                </h3>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {t('seo.shoppers.p1')}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-[var(--brand-ink)] text-xl">
                  {t('seo.multilingual.title')}
                </h3>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {t('seo.multilingual.p1')}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <h2 className="wa-display font-bold text-3xl text-foreground">
                {t('seo.faq.title')}
              </h2>
              <div className="flex flex-col gap-4">
                {faqItems.map((item) => (
                  <div
                    key={item.question}
                    className="rounded-[20px] border border-border bg-white p-6"
                  >
                    <h3 className="mb-2 font-bold text-[var(--brand-ink)] text-lg">
                      {item.question}
                    </h3>
                    <p className="text-muted-foreground text-base leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-muted-foreground text-lg leading-relaxed">
              {t('seo.outro')}
            </p>
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
        <span className="rounded-full border border-[var(--brand-chip)] bg-[var(--brand-softer)] px-3 py-1 font-bold text-[var(--brand-dark)] text-sm">
          {step}
        </span>
        <h3 className="wa-display text-balance font-bold text-2xl text-[var(--brand-ink)] sm:text-3xl">
          {title}
        </h3>
        <p className="max-w-md text-muted-foreground text-lg leading-relaxed">
          {description}
        </p>
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
