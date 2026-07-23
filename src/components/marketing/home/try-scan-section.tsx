'use client';

import { LocaleLink } from '@/i18n/navigation';
import {
  ArrowRightIcon,
  CameraIcon,
  ImageUpIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hero try-out card: the visitor drops ONE shelf photo and the real
 * rows-hd-fast pipeline draws boxes around every detected product. Lives in
 * the hero's right column (replacing the static phone mock) so the first
 * thing a visitor sees is a working demo. Free, no sign-up; the API enforces
 * a per-IP lifetime cap and a shelf-photo pre-check gate.
 */

interface TryBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TryResult {
  boxes: TryBox[];
  count: number;
  names: string[];
  preview: { dataUrl: string; width: number; height: number };
  remaining: number;
}

type Phase = 'idle' | 'scanning' | 'result' | 'error';

type ErrorCode =
  | 'not_shelf'
  | 'not_legible'
  | 'too_large'
  | 'invalid_image'
  | 'rate_limited'
  | 'limit_reached'
  | 'scan_failed';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const STAGES = ['stageChecking', 'stageRows', 'stageReading'] as const;

function toErrorCode(value: unknown): ErrorCode {
  switch (value) {
    case 'not_shelf':
    case 'not_legible':
    case 'too_large':
    case 'invalid_image':
    case 'rate_limited':
    case 'limit_reached':
      return value;
    default:
      return 'scan_failed';
  }
}

export function HeroTryScan() {
  const t = useTranslations('HomePage.tryScan');
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [result, setResult] = useState<TryResult | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode>('scan_failed');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Cosmetic stage text while the single scan request runs.
  useEffect(() => {
    if (phase !== 'scanning') return;
    setStageIndex(0);
    const timer = setInterval(
      () => setStageIndex((i) => Math.min(i + 1, STAGES.length - 1)),
      4000
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview]
  );

  const reset = useCallback(() => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setResult(null);
    setPhase('idle');
  }, [localPreview]);

  const scan = useCallback(
    async (file: File) => {
      const looksLikeImage =
        file.type.startsWith('image/') ||
        /\.(heic|heif)$/i.test(file.name) ||
        file.type === '';
      if (!looksLikeImage) {
        setErrorCode('scan_failed');
        setPhase('error');
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setErrorCode('too_large');
        setPhase('error');
        return;
      }
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(URL.createObjectURL(file));
      setPhase('scanning');
      try {
        const form = new FormData();
        form.set('image', file);
        const res = await fetch('/api/try-scan', {
          method: 'POST',
          body: form,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.error) {
          setErrorCode(toErrorCode(data?.error));
          setPhase('error');
          return;
        }
        setResult(data as TryResult);
        setPhase('result');
      } catch {
        setErrorCode('scan_failed');
        setPhase('error');
      }
    },
    [localPreview]
  );

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) void scan(file);
    },
    [scan]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void scan(file);
    },
    [scan]
  );

  const previewAspect =
    result && result.preview.width > 0
      ? `${result.preview.width} / ${result.preview.height}`
      : undefined;

  return (
    <div className="wa-fade-up mx-auto w-full max-w-[420px]">
      <div className="relative overflow-hidden rounded-[28px] bg-[var(--brand-cream)] p-4 shadow-[0_26px_60px_rgba(0,0,0,0.32)]">
        {/* Idle: drop zone + upload/camera buttons */}
        {phase === 'idle' && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            className={`flex min-h-[340px] flex-col items-center justify-center gap-4 rounded-[18px] border-2 border-dashed p-6 text-center transition-colors ${
              dragOver
                ? 'border-[var(--brand-green)] bg-[#EDF4DE]'
                : 'border-[#CBD8B8] bg-white/60'
            }`}
          >
            <span className="rounded-full bg-[var(--brand-green)] px-3 py-1 font-bold font-mono text-[10px] text-[var(--brand-lime)] tracking-[0.12em]">
              {t('tag')}
            </span>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-lime)]/25">
              <ImageUpIcon
                className="size-7 text-[var(--brand-green)]"
                aria-hidden
              />
            </div>
            <p className="font-bold text-[#12352C] text-lg leading-snug">
              {t('dropHint')}
            </p>
            <p className="-mt-1 max-w-[16rem] text-[#566058] text-sm leading-relaxed">
              {t('subtitle')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--brand-green)] px-5 font-bold text-[var(--brand-lime)] transition-transform hover:bg-[var(--brand-green-hover)] active:scale-[0.97]"
              >
                <ImageUpIcon className="size-4" aria-hidden />
                {t('upload')}
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex h-11 items-center gap-2 rounded-full border-[1.5px] border-[#BFCDAB] px-5 font-semibold text-[var(--brand-green)] transition-colors hover:border-[var(--brand-green)] sm:hidden"
              >
                <CameraIcon className="size-4" aria-hidden />
                {t('takePhoto')}
              </button>
            </div>
            <p className="text-[#7A8478] text-xs">{t('fileHint')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={onFilePicked}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFilePicked}
            />
          </div>
        )}

        {/* Scanning: dimmed preview + scanline + stage text */}
        {phase === 'scanning' && localPreview && (
          <div className="relative min-h-[340px] overflow-hidden rounded-[18px] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={localPreview}
              alt=""
              className="h-full max-h-[460px] w-full object-cover opacity-45"
            />
            <div className="wa-scanline h-[3px] rounded-full bg-[var(--brand-lime)] shadow-[0_0_16px_var(--brand-lime)]" />
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-black/70 to-transparent p-4">
              <span className="size-2 animate-pulse rounded-full bg-[var(--brand-lime)]" />
              <span className="font-semibold text-sm text-white">
                {t(STAGES[stageIndex])}
              </span>
            </div>
          </div>
        )}

        {/* Result: server preview + box overlays + compact footer */}
        {phase === 'result' && result && (
          <div className="flex flex-col gap-3">
            <div
              className="relative w-full overflow-hidden rounded-[18px]"
              style={{ aspectRatio: previewAspect }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.preview.dataUrl}
                alt=""
                className="block h-full w-full"
              />
              {result.boxes.map((b, i) => (
                <div
                  key={`${b.x}-${b.y}-${i}`}
                  className="absolute rounded-[3px] border-2 border-[var(--brand-lime)] shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
                  style={{
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    width: `${b.w * 100}%`,
                    height: `${b.h * 100}%`,
                  }}
                >
                  {b.w > 0.16 && (
                    <span className="absolute top-0 left-0 max-w-full truncate rounded-br-[3px] bg-[var(--brand-lime)] px-1 py-px font-semibold text-[10px] text-[var(--brand-green)] leading-tight">
                      {b.label}
                    </span>
                  )}
                </div>
              ))}
              <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 font-bold text-[var(--brand-lime)] text-xs shadow-[0_6px_16px_rgba(0,0,0,0.25)]">
                <span className="size-1.5 rounded-full bg-[var(--brand-lime)]" />
                {t('resultTitle', { count: result.count })}
              </span>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-[#7A8478] text-xs">
                {t('remaining', { count: result.remaining })}
              </span>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--brand-green)] text-sm transition-opacity hover:opacity-70"
              >
                <RotateCcwIcon className="size-3.5" aria-hidden />
                {t('tryAnother')}
              </button>
            </div>
          </div>
        )}

        {/* Error: compact friendly card */}
        {phase === 'error' && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 rounded-[18px] bg-white/60 p-6 text-center">
            <p className="max-w-[18rem] font-semibold text-[#12352C]">
              {t(`err.${errorCode}`)}
            </p>
            {errorCode === 'limit_reached' ? (
              <LocaleLink
                href="/auth/register"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--brand-green)] px-5 font-bold text-[var(--brand-lime)] transition-transform hover:bg-[var(--brand-green-hover)] active:scale-[0.97]"
              >
                {t('cta')}
                <ArrowRightIcon className="size-4" aria-hidden />
              </LocaleLink>
            ) : (
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center gap-2 rounded-full border-[1.5px] border-[#BFCDAB] px-5 font-semibold text-[var(--brand-green)] transition-colors hover:border-[var(--brand-green)]"
              >
                <RotateCcwIcon className="size-4" aria-hidden />
                {t('tryAnother')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
