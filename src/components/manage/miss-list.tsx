'use client';

import { markNeedsScanAction } from '@/actions/insights-actions';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Miss {
  id: string;
  queryText: string;
  hitlessCount: number;
}

/**
 * "Products shoppers couldn't find" with a one-tap re-scan reminder (§4.3).
 * When staff photograph the item and save, it clears automatically.
 */
export function MissList({ misses }: { misses: Miss[] }) {
  const t = useTranslations('Manage.insights');
  const [reminded, setReminded] = useState<Set<string>>(new Set());

  async function remind(id: string) {
    setReminded((prev) => new Set(prev).add(id));
    await markNeedsScanAction({ missId: id }).catch(() => {});
  }

  if (misses.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('noMisses')}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {misses.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between gap-3 rounded-lg border p-3"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{m.queryText}</p>
            <p className="text-muted-foreground text-xs">
              {t('timesAsked', { count: m.hitlessCount })}
            </p>
          </div>
          {reminded.has(m.id) ? (
            <span className="text-green-700 text-sm dark:text-green-400">
              {t('reminded')}
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => remind(m.id)}>
              {t('rescan')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
