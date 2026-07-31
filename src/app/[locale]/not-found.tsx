import { AnimatedBear } from '@/components/layout/animated-bear';
import { Button } from '@/components/ui/button';
import { LocaleLink } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

/**
 * Note that `app/[locale]/[...rest]/page.tsx`
 * is necessary for this page to render.
 *
 * https://next-intl.dev/docs/environments/error-files#not-foundjs
 * https://next-intl.dev/docs/environments/error-files#catching-non-localized-requests
 */
export default function NotFound() {
  const t = useTranslations('NotFoundPage');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <AnimatedBear size={108} />
      <div aria-hidden className="-mt-4 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 animate-pulse rounded-full bg-[var(--brand)]"
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </div>

      <h1 className="text-4xl font-bold">{t('title')}</h1>

      <p className="text-balance text-center text-xl font-medium px-4">
        {t('message')}
      </p>

      <Button asChild size="lg" variant="default">
        <LocaleLink href="/">{t('backToHome')}</LocaleLink>
      </Button>
    </div>
  );
}
