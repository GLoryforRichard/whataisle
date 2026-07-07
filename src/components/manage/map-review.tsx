'use client';

import {
  confirmMapAction,
  requestLayoutUpdateAction,
  returnMapAction,
} from '@/actions/map-actions';
import { StoreMapSvg } from '@/components/store/store-map-svg';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { FloorMapJson, FloorMapStatus } from '@/db/store.schema';
import { useLocaleRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

interface MapReviewProps {
  status: FloorMapStatus | 'missing';
  mapJson: FloorMapJson | null;
}

export function MapReview({ status, mapJson }: MapReviewProps) {
  const t = useTranslations('Manage.map');
  const router = useLocaleRouter();
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [layoutNote, setLayoutNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await confirmMapAction({});
      if (res?.data?.success) {
        toast.success(t('confirmed'));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReturn() {
    if (!returnNote.trim()) return;
    setBusy(true);
    try {
      const res = await returnMapAction({ note: returnNote });
      if (res?.data?.success) {
        toast.success(t('returned'));
        setReturning(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendLayout() {
    if (!layoutNote.trim()) return;
    setBusy(true);
    try {
      const res = await requestLayoutUpdateAction({ note: layoutNote });
      if (res?.data?.success) {
        toast.success(t('layoutSent'));
        setLayoutOpen(false);
        setLayoutNote('');
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === 'missing' || status === 'none') {
    return <p className="text-muted-foreground">{t('statusNone')}</p>;
  }
  if (status === 'draft') {
    return <p className="text-muted-foreground">{t('statusBuilding')}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground">
        {status === 'published' ? t('published') : t('awaitingConfirm')}
      </p>

      {mapJson ? (
        <div className="max-w-md">
          <StoreMapSvg mapJson={mapJson} />
        </div>
      ) : null}

      {status === 'awaiting_confirm' ? (
        returning ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="return-note" className="text-sm">
              {t('returnPrompt')}
            </label>
            <Textarea
              id="return-note"
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              placeholder={t('returnPlaceholder')}
              rows={3}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReturning(false)}>
                {t('return')}
              </Button>
              <Button
                onClick={sendReturn}
                disabled={busy || !returnNote.trim()}
              >
                {t('returnSend')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button size="lg" onClick={confirm} disabled={busy}>
              {t('confirm')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setReturning(true)}
            >
              {t('return')}
            </Button>
          </div>
        )
      ) : null}

      {status === 'published' ? (
        layoutOpen ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="layout-note" className="text-sm">
              {t('layoutPrompt')}
            </label>
            <Textarea
              id="layout-note"
              value={layoutNote}
              onChange={(e) => setLayoutNote(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLayoutOpen(false)}>
                {t('return')}
              </Button>
              <Button
                onClick={sendLayout}
                disabled={busy || !layoutNote.trim()}
              >
                {t('layoutSend')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => setLayoutOpen(true)}
          >
            {t('layoutUpdate')}
          </Button>
        )
      ) : null}
    </div>
  );
}
