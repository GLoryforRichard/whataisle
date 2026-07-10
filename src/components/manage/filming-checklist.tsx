import {
  ClockIcon,
  DoorOpenIcon,
  FootprintsIcon,
  SignpostIcon,
  VideoIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const STEPS = [
  { key: 'entrance', icon: DoorOpenIcon },
  { key: 'everyAisle', icon: FootprintsIcon },
  { key: 'categorySigns', icon: SignpostIcon },
  { key: 'steady', icon: VideoIcon },
  { key: 'oneTake', icon: ClockIcon },
] as const;

/**
 * Filming instructions shown above the uploader — the video is the raw
 * material for the store's product map, so coverage gaps become map gaps.
 */
export async function FilmingChecklist() {
  const t = await getTranslations('Manage.video.instructions');

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold text-lg">{t('title')}</h2>
      <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => (
          <li key={step.key} className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-green)]/10 font-semibold text-[var(--brand-green)] text-sm">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium text-sm">
                <step.icon
                  className="size-4 text-[var(--brand-green)]"
                  aria-hidden
                />
                {t(`${step.key}.title`)}
              </p>
              <p className="mt-0.5 text-muted-foreground text-sm">
                {t(`${step.key}.detail`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
