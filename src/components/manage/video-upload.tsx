'use client';

import { LocaleLink } from '@/i18n/navigation';
import {
  ArrowRightIcon,
  CheckIcon,
  FilmIcon,
  Loader2Icon,
  VideoIcon,
} from 'lucide-react';
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

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export function VideoUpload({ hasVideo }: { hasVideo: boolean }) {
  const t = useTranslations('Manage.video');
  const [phase, setPhase] = useState<Phase>(hasVideo ? 'done' : 'idle');
  const [percent, setPercent] = useState(0);
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
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
    setFileMeta({ name: file.name, size: file.size });
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

  function onFiles(files: FileList | null | undefined) {
    const f = files?.[0];
    if (f?.type.startsWith('video/') || f) upload(f as File);
  }

  // ── Done: celebratory confirmation ──
  if (phase === 'done') {
    return (
      <div className="wa-pop flex flex-col items-center gap-4 rounded-[22px] bg-[var(--brand-green)] p-8 text-center text-[var(--brand-cream)] shadow-[0_18px_44px_rgba(15,53,44,0.16)] sm:p-10">
        <div className="flex size-16 items-center justify-center rounded-full bg-[var(--brand-lime)]">
          <CheckIcon
            className="size-9 text-[var(--brand-green)]"
            strokeWidth={2.6}
          />
        </div>
        <p className="font-bold text-2xl">{t('received')}</p>
        <p className="max-w-md text-[var(--brand-cream)]/75 leading-relaxed">
          {t('receivedNote')}
        </p>
        <LocaleLink
          href="/manage/shelves"
          className="mt-2 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--brand-lime)] px-6 font-bold text-[var(--brand-green)] transition-transform hover:bg-[var(--brand-lime-hover)] active:scale-[0.97]"
        >
          {t('startScanning')}
          <ArrowRightIcon className="size-[18px]" aria-hidden />
        </LocaleLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Filming guide */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,53,44,0.04)]">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-[#F1F7E8]">
            <FilmIcon
              className="size-[18px] text-[var(--brand-green)]"
              aria-hidden
            />
          </div>
          <h2 className="font-bold text-foreground text-lg">
            {t('guideTitle')}
          </h2>
        </div>
        <ol className="flex flex-col gap-3">
          {[t('guide1'), t('guide2'), t('guide3')].map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-lime)] font-bold text-[13px] text-[var(--brand-green)]">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />

      {phase === 'uploading' ? (
        /* Upload progress */
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#F1F7E8]">
              <Loader2Icon className="size-5 animate-spin text-[var(--brand-green)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">
                {fileMeta?.name ?? t('pick')}
              </p>
              {fileMeta ? (
                <p className="text-muted-foreground text-sm">
                  {formatSize(fileMeta.size)}
                </p>
              ) : null}
            </div>
            <span className="font-bold text-[var(--brand-green)] text-xl tabular-nums">
              {percent}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#EEF0EA]">
            <div
              className="h-full rounded-full bg-[var(--brand-green)] transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-[#7B8479] text-xs">{t('keepOpen')}</p>
        </div>
      ) : (
        /* Dropzone */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-10 ${
            dragging
              ? 'border-[var(--brand-green)] bg-[#F1F7E8]'
              : 'border-[#CBD9C6] bg-card hover:border-[var(--brand-green)] hover:bg-[#F7FBEF]'
          }`}
        >
          <div className="flex size-16 items-center justify-center rounded-2xl bg-[#F1F7E8]">
            <VideoIcon
              className="size-8 text-[var(--brand-green)]"
              aria-hidden
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-foreground text-lg">
              {t('dropHint')}
            </p>
            <p className="text-muted-foreground text-sm">{t('formats')}</p>
          </div>
          <span className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--brand-green)] px-6 font-bold text-[var(--brand-lime)] transition-transform active:scale-[0.97]">
            <FilmIcon className="size-[18px]" aria-hidden />
            {t('pick')}
          </span>
        </button>
      )}

      {phase === 'error' ? (
        <p
          role="alert"
          className="rounded-xl border border-[#E7C86F] bg-[#FDF6E3] p-3.5 text-[#7A5B18] text-sm"
        >
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
