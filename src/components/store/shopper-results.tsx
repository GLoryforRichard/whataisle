'use client';

import { StoreMapSvg } from '@/components/store/store-map-svg';
import type { FloorMapJson } from '@/db/store.schema';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ImageIcon,
  Loader2Icon,
  MapPinIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Tone = 'confident' | 'multi' | 'category' | 'none';

interface Location {
  shelfCode: string;
  side: 'L' | 'R' | null;
  seenCount: number;
}

interface Candidate {
  productId: string;
  canonicalName: string;
  nameZh: string | null;
  evidenceCount: number;
  confidenceState: 'normal' | 'doubted';
  thumbnailUrl: string | null;
  locations: Location[];
}

interface FinalResult {
  tone: Tone;
  answerEn: string;
  answerZh: string;
  candidates: Candidate[];
  guesses: Candidate[];
  degraded: boolean;
  stepCount: number;
}

interface Step {
  key: string;
  labelEn: string;
  labelZh: string;
}

/**
 * The fixed shopper results page (requirements §4.1), top to bottom:
 * header echo → collapsible thinking strip → answer banner (4 tones) →
 * ranked candidate list (thumbnail, shelf badge, seen N×) → where-to-find →
 * "not there" feedback → no-results rephrase.
 */
export function ShopperResults({
  query,
  mapJson,
}: {
  query: string;
  mapJson: FloorMapJson | null;
}) {
  const t = useTranslations('Shopper.results');
  const locale = useLocale();
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [deflected, setDeflected] = useState<{ en: string; zh: string } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [activeShelf, setActiveShelf] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !query) return;
    started.current = true;
    const es = new EventSource(
      `/api/store/search?q=${encodeURIComponent(query)}&input=text`
    );
    es.addEventListener('step', (e) => {
      const step = JSON.parse((e as MessageEvent).data);
      setSteps((prev) => [...prev, step]);
    });
    es.addEventListener('result', (e) => {
      const r: FinalResult = JSON.parse((e as MessageEvent).data);
      setResult(r);
      const shown = r.candidates.length > 0 ? r.candidates : r.guesses;
      setActiveShelf(shown[0]?.locations[0]?.shelfCode ?? null);
      setLoading(false);
      es.close();
    });
    es.addEventListener('deflected', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setDeflected({ en: d.answerEn, zh: d.answerZh });
      setLoading(false);
      es.close();
    });
    es.addEventListener('error', () => {
      setLoading(false);
      es.close();
    });
    return () => es.close();
  }, [query]);

  const answer = result
    ? locale === 'zh'
      ? result.answerZh
      : result.answerEn
    : '';

  async function reportNotThere(productId: string) {
    setReported((prev) => new Set(prev).add(productId));
    try {
      await fetch('/api/store/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
    } catch {
      // Feedback is best-effort; the acknowledgement already showed.
    }
  }

  function name(c: Candidate): string {
    return locale === 'zh' && c.nameZh ? c.nameZh : c.canonicalName;
  }

  const isDarkAnswer = result?.tone === 'confident' || result?.tone === 'multi';
  const answerClass = isDarkAnswer
    ? 'bg-[var(--brand-green)] text-[var(--brand-cream)] border-transparent'
    : result?.tone === 'category'
      ? 'bg-[#FDF6E3] border-[#E7C86F] text-[#7A5B18]'
      : 'bg-white border-[#EAE3D2] text-[var(--brand-ink)]';

  const shown = result
    ? result.candidates.length > 0
      ? result.candidates
      : result.guesses
    : [];
  const answerShelf = shown[0]?.locations[0]
    ? shown[0].locations[0].side
      ? `${shown[0].locations[0].shelfCode}${shown[0].locations[0].side}`
      : shown[0].locations[0].shelfCode
    : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5">
      {/* Back chip */}
      <button
        type="button"
        onClick={() => {
          window.location.href = '/';
        }}
        className="inline-flex h-10 items-center gap-1.5 self-start rounded-full border border-[#D5DCCB] bg-white px-4 font-semibold text-[var(--brand-ink)] text-sm transition-transform active:scale-[0.97]"
      >
        ← {t('back')}
      </button>

      {/* Echo of the query */}
      <div className="flex items-baseline gap-2">
        <span className="text-[#566058] text-sm">{t('youAsked')}:</span>
        <span className="font-bold text-[var(--brand-ink)] text-xl">
          {query}
        </span>
      </div>

      {/* Live "searching…" card */}
      {loading ? (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-[#EAE3D2] bg-white p-7">
          <Loader2Icon className="size-6 animate-spin text-[var(--brand-green)]" />
          <span className="text-[#566058]">{t('thinkingLive')}</span>
        </div>
      ) : null}

      {/* Collapsible thinking strip (details) */}
      {steps.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setThinkingOpen((v) => !v)}
            className="flex items-center gap-2 self-start rounded-full border border-[#D5DCCB] bg-white px-3 py-1.5 font-mono text-[#566058] text-xs uppercase tracking-wide"
          >
            {thinkingOpen ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
            {loading
              ? t('thinkingLive')
              : t('thinking', { count: result?.stepCount ?? steps.length })}
          </button>
          {thinkingOpen || loading ? (
            <ol className="flex flex-col gap-1 border-[#D8EBB4] border-l-2 pl-4 text-[#566058] text-sm">
              {steps.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2">
                  {loading && i === steps.length - 1 ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2Icon className="size-3.5 text-[var(--brand-green)]" />
                  )}
                  {locale === 'zh' ? s.labelZh : s.labelEn}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}

      {/* Deflection (content safety) */}
      {deflected ? (
        <div className="rounded-2xl border border-[#EAE3D2] bg-white p-4 text-center text-[var(--brand-ink)]">
          {locale === 'zh' ? deflected.zh : deflected.en}
        </div>
      ) : null}

      {/* Answer card */}
      {result ? (
        <div
          className={`wa-pop flex items-center gap-4 rounded-2xl border p-4 shadow-[0_10px_26px_rgba(15,53,44,0.12)] ${answerClass}`}
        >
          {isDarkAnswer && answerShelf ? (
            <div className="shrink-0 rounded-xl bg-[var(--brand-lime)] px-4 py-3 font-bold text-2xl text-[var(--brand-green)] leading-none">
              {answerShelf}
            </div>
          ) : null}
          <p className="font-semibold text-lg leading-snug">{answer}</p>
        </div>
      ) : null}

      {result?.degraded ? (
        <p className="text-[#566058] text-sm">{t('degraded')}</p>
      ) : null}

      {/* Candidate list */}
      {shown.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <p className="font-semibold text-[#566058] text-sm">
            {t('possibleItems', { count: shown.length })}
          </p>
          {shown.map((c) => {
            const loc = c.locations[0];
            const isActive = loc && activeShelf === loc.shelfCode;
            return (
              <div
                key={c.productId}
                className={`rounded-2xl border bg-white p-3.5 ${isActive && mapJson ? 'border-[var(--brand-green)]' : 'border-[#EAE3D2]'}`}
                onClick={() =>
                  loc && mapJson ? setActiveShelf(loc.shelfCode) : undefined
                }
                style={{ cursor: loc && mapJson ? 'pointer' : 'default' }}
              >
                <div className="flex items-center gap-3">
                  {c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.thumbnailUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-[10px] object-cover"
                    />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F7E8]">
                      <ImageIcon className="size-6 text-[#566058]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--brand-ink)]">
                      {name(c)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {loc ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-lime)] px-3 py-0.5 font-bold text-[var(--brand-green)] text-sm">
                          <MapPinIcon className="size-3.5" />
                          {t('shelfBadge', {
                            code: loc.side
                              ? `${loc.shelfCode}${loc.side}`
                              : loc.shelfCode,
                          })}
                        </span>
                      ) : null}
                      <span className="text-[#566058] text-xs">
                        {c.evidenceCount === 1
                          ? t('seenOne')
                          : t('seen', { count: c.evidenceCount })}
                      </span>
                    </div>
                    {c.confidenceState === 'doubted' ? (
                      <p className="mt-1.5 text-[#B45309] text-xs">
                        {t('doubtedNote')}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Where to find it — text directions (also shown with the map) */}
                {loc && !mapJson ? (
                  <p className="mt-2 text-[#566058] text-sm">
                    {t('whereToFind')}:{' '}
                    {t('mapComingSoon', { code: loc.shelfCode })}
                  </p>
                ) : null}

                {/* "I looked — it's not there" feedback */}
                <div className="mt-2">
                  {reported.has(c.productId) ? (
                    <span className="font-semibold text-[var(--brand-green)] text-sm">
                      {t('notThereThanks')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        reportNotThere(c.productId);
                      }}
                      className="text-[#566058] text-sm underline underline-offset-2"
                    >
                      {t('notThere')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* WHERE TO FIND IT — floor map with the target shelf highlighted (§4.1) */}
      {mapJson && shown.length > 0 && activeShelf ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-[#566058] text-sm">
            {t('whereToFind')}
          </p>
          <StoreMapSvg
            mapJson={mapJson}
            highlight={activeShelf}
            highlightSide={
              shown.find((c) => c.locations[0]?.shelfCode === activeShelf)
                ?.locations[0]?.side ?? null
            }
            onSelectShelf={setActiveShelf}
          />
        </div>
      ) : null}

      {/* No results */}
      {result && result.tone === 'none' && shown.length === 0 ? (
        <div className="rounded-2xl border border-[#EAE3D2] bg-white p-4 text-center">
          <p className="font-semibold text-[var(--brand-ink)]">
            {t('noResults')}
          </p>
          <p className="mt-1 text-[#566058] text-sm">{t('rephrase')}</p>
        </div>
      ) : null}
    </div>
  );
}
