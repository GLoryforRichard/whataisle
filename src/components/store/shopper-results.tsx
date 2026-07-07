'use client';

import { StoreMapSvg } from '@/components/store/store-map-svg';
import { Button } from '@/components/ui/button';
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

  const toneBg: Record<Tone, string> = {
    confident:
      'bg-green-50 border-green-300 dark:bg-green-950 dark:border-green-800',
    multi: 'bg-blue-50 border-blue-300 dark:bg-blue-950 dark:border-blue-800',
    category:
      'bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-800',
    none: 'bg-muted border-border',
  };

  const shown = result
    ? result.candidates.length > 0
      ? result.candidates
      : result.guesses
    : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      {/* Echo of the query */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-sm">{t('youAsked')}:</span>
        <span className="font-medium text-foreground">{query}</span>
      </div>

      {/* Collapsible thinking strip */}
      <button
        type="button"
        onClick={() => setThinkingOpen((v) => !v)}
        className="flex items-center gap-2 self-start rounded-md border px-3 py-1.5 text-muted-foreground text-xs uppercase tracking-wide"
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
      {(thinkingOpen || loading) && steps.length > 0 ? (
        <ol className="flex flex-col gap-1 border-l-2 pl-4 text-muted-foreground text-sm">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              {loading && i === steps.length - 1 ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2Icon className="size-3.5 text-green-600" />
              )}
              {locale === 'zh' ? s.labelZh : s.labelEn}
            </li>
          ))}
        </ol>
      ) : null}

      {/* Deflection (content safety) */}
      {deflected ? (
        <div className="rounded-lg border bg-muted p-4 text-center">
          {locale === 'zh' ? deflected.zh : deflected.en}
        </div>
      ) : null}

      {/* Answer banner */}
      {result ? (
        <div
          className={`rounded-xl border p-4 font-medium text-lg ${toneBg[result.tone]}`}
        >
          {answer}
        </div>
      ) : null}

      {result?.degraded ? (
        <p className="text-muted-foreground text-sm">{t('degraded')}</p>
      ) : null}

      {/* Candidate list */}
      {shown.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t('possibleItems', { count: shown.length })}
          </p>
          {shown.map((c) => {
            const loc = c.locations[0];
            const isActive = loc && activeShelf === loc.shelfCode;
            return (
              <div
                key={c.productId}
                className={`rounded-lg border p-3 ${isActive && mapJson ? 'border-primary' : ''}`}
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
                      className="size-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded bg-muted">
                      <ImageIcon className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{name(c)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {loc ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 font-semibold text-primary-foreground text-sm">
                          <MapPinIcon className="size-3.5" />
                          {t('shelfBadge', {
                            code: loc.side
                              ? `${loc.shelfCode}${loc.side}`
                              : loc.shelfCode,
                          })}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground text-xs">
                        {c.evidenceCount === 1
                          ? t('seenOne')
                          : t('seen', { count: c.evidenceCount })}
                      </span>
                    </div>
                    {c.confidenceState === 'doubted' ? (
                      <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                        {t('doubtedNote')}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Where to find it — text directions (also shown with the map) */}
                {loc && !mapJson ? (
                  <p className="mt-2 text-muted-foreground text-sm">
                    {t('whereToFind')}:{' '}
                    {t('mapComingSoon', { code: loc.shelfCode })}
                  </p>
                ) : null}

                {/* "I looked — it's not there" feedback */}
                <div className="mt-2">
                  {reported.has(c.productId) ? (
                    <span className="text-green-700 text-sm dark:text-green-400">
                      {t('notThereThanks')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        reportNotThere(c.productId);
                      }}
                      className="text-muted-foreground text-sm underline underline-offset-2"
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
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
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
        <div className="rounded-lg border p-4 text-center">
          <p className="font-medium">{t('noResults')}</p>
          <p className="mt-1 text-muted-foreground text-sm">{t('rephrase')}</p>
        </div>
      ) : null}

      <Button
        variant="ghost"
        className="self-start"
        onClick={() => {
          window.location.href = '/';
        }}
      >
        {t('back')}
      </Button>
    </div>
  );
}
