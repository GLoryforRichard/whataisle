'use client';

import { Button } from '@/components/ui/button';
import { LocaleLink } from '@/i18n/navigation';
import { CheckCircle2Icon, FilmIcon, Loader2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/**
 * Resumable walk-through video upload (requirements §6). Splits the file into
 * chunks and uploads them one by one; a failed chunk is retried without
 * restarting the whole upload. Shows a one-screen filming guide and an explicit
 * "we've received it" confirmation.
 */

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — safe for Next route body limits
const MAX_RETRIES = 4;

type Phase = 'idle' | 'uploading' | 'done' | 'error';

export function VideoUpload({ hasVideo }: { hasVideo: boolean }) {
  const t = useTranslations('Manage.video');
  const [phase, setPhase] = useState<Phase>(hasVideo ? 'done' : 'idle');
  const [percent, setPercent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function postChunk(videoId: string, index: number, blob: Blob) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const form = new FormData();
        form.set('videoId', videoId);
        form.set('chunkIndex', String(index));
        form.set('chunk', blob);
        const res = await fetch('/api/owner/video/chunk', {
          method: 'POST',
          body: form,
        });
        if (res.ok) return;
      } catch {
        // fall through to retry
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    throw new Error('chunk_failed');
  }

  async function upload(file: File) {
    setPhase('uploading');
    setPercent(0);
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    try {
      const initRes = await fetch('/api/owner/video/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, totalChunks }),
      });
      if (!initRes.ok) throw new Error('init_failed');
      const { videoId } = await initRes.json();

      for (let i = 0; i < totalChunks; i++) {
        const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await postChunk(videoId, i, blob);
        setPercent(Math.round(((i + 1) / totalChunks) * 100));
      }

      const done = await fetch('/api/owner/video/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (!done.ok) throw new Error('complete_failed');
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border p-8 text-center">
        <CheckCircle2Icon className="size-10 text-green-600" />
        <p className="font-semibold text-xl">{t('received')}</p>
        <p className="max-w-md text-muted-foreground">{t('receivedNote')}</p>
        <LocaleLink
          href="/manage/shelves"
          className="text-primary underline underline-offset-4"
        >
          {t('startScanning')}
        </LocaleLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-muted/40 p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-lg">
          <FilmIcon className="size-5" /> {t('guideTitle')}
        </h2>
        <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
          <li>{t('guide1')}</li>
          <li>{t('guide2')}</li>
          <li>{t('guide3')}</li>
        </ol>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />

      {phase === 'uploading' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t('uploading', { percent })}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          className="h-14 text-lg"
          onClick={() => inputRef.current?.click()}
        >
          <FilmIcon className="mr-2 size-5" /> {t('pick')}
        </Button>
      )}

      {phase === 'error' ? (
        <p role="alert" className="text-destructive">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
