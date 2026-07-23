'use client';

import { StoreMapSvg } from '@/components/store/store-map-svg';
import { Button } from '@/components/ui/button';
import type { FloorMapJson } from '@/db/store.schema';
import { outboxDelete, outboxPut, outboxSupported } from '@/lib/scan-outbox';
import {
  CameraIcon,
  CheckCircle2Icon,
  ImageIcon,
  Loader2Icon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Shelf {
  id: string;
  code: string;
  label: string | null;
}

interface DetectedProduct {
  name: string;
  nameZh?: string;
  category?: string;
  confidence?: string;
  thumbnailDataUrl?: string;
}

type PhotoStatus = 'pending' | 'recognizing' | 'done' | 'failed';

interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  status: PhotoStatus;
  storageKey?: string;
  productCount?: number;
  /** Products detected in THIS photo; the review list merges across photos. */
  products?: DetectedProduct[];
}

interface MergedProduct extends DetectedProduct {
  key: string;
  removed: boolean;
}

/** One step of the save pipeline, streamed over SSE from the save route. */
interface SaveStep {
  key: string;
  labelEn: string;
  labelZh: string;
  done: boolean;
  startedAt: number;
  ms?: number;
}

/** In-page camera viewport state ("Take photo" opens a live viewfinder). */
type CameraState = 'closed' | 'starting' | 'live' | 'denied' | 'unavailable';

const MAX_CONCURRENT = 2;

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ScanFlow({
  shelves,
  mapJson,
}: {
  shelves: Shelf[];
  mapJson: FloorMapJson | null;
}) {
  const t = useTranslations('Store.staff.scan');
  const locale = useLocale();
  const [shelf, setShelf] = useState<Shelf | null>(
    shelves.length === 1 ? shelves[0] : null
  );
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveSteps, setSaveSteps] = useState<SaveStep[]>([]);
  const [saveResult, setSaveResult] = useState<{
    created: number;
    updated: number;
  } | null>(null);
  const [camera, setCamera] = useState<CameraState>('closed');
  const libraryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlight = useRef(0);
  const queue = useRef<string[]>([]);

  // The review list is DERIVED from the photos (union of each done photo's
  // detections, deduped by normalized name, preferring entries with a
  // thumbnail / higher confidence) so removing a photo removes its products.
  const merged = useMemo<MergedProduct[]>(() => {
    const byKey = new Map<string, MergedProduct>();
    const rank = (c?: string) => CONFIDENCE_RANK[c ?? 'low'] ?? 0;
    for (const photo of photos) {
      if (photo.status !== 'done' || !photo.products) continue;
      for (const [i, d] of photo.products.entries()) {
        // "Unidentified product" placeholders are distinct unknown SKUs —
        // merging them by name would collapse them into a single row.
        const key =
          d.name === 'Unidentified product'
            ? `__unidentified_${photo.id}_${i}`
            : normalizeKey(d.name);
        if (!key) continue;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, { ...d, key, removed: removedKeys.has(key) });
          continue;
        }
        let next = existing;
        if (rank(d.confidence) > rank(next.confidence)) {
          next = {
            ...next,
            name: d.name,
            nameZh: d.nameZh ?? next.nameZh,
            category: d.category ?? next.category,
            confidence: d.confidence,
          };
        }
        if (!next.thumbnailDataUrl && d.thumbnailDataUrl) {
          next = { ...next, thumbnailDataUrl: d.thumbnailDataUrl };
        }
        if (next !== existing) byKey.set(key, next);
      }
    }
    return Array.from(byKey.values());
  }, [photos, removedKeys]);

  const visibleProducts = merged.filter((p) => !p.removed);

  const totalPhotos = photos.length;
  const readingCount = photos.filter(
    (p) => p.status === 'pending' || p.status === 'recognizing'
  ).length;
  const doneCount = photos.filter((p) => p.status === 'done').length;
  const failedCount = photos.filter((p) => p.status === 'failed').length;

  const processPhoto = useCallback(
    async (photo: PhotoItem) => {
      if (!shelf) return;
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id ? { ...p, status: 'recognizing' } : p
        )
      );
      try {
        const form = new FormData();
        form.set('shelfId', shelf.id);
        form.set('image', photo.file);
        const res = await fetch('/api/store/staff/scan', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) throw new Error('processing_failed');
        const data = await res.json();
        const detected: DetectedProduct[] = data.products ?? [];
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id
              ? {
                  ...p,
                  status: 'done',
                  storageKey: data.storageKey,
                  productCount: detected.length,
                  products: detected,
                }
              : p
          )
        );
        if (outboxSupported()) await outboxDelete(photo.id).catch(() => {});
      } catch {
        setPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: 'failed' } : p))
        );
      }
    },
    [shelf]
  );

  const pump = useCallback(() => {
    while (inFlight.current < MAX_CONCURRENT && queue.current.length > 0) {
      const id = queue.current.shift();
      if (!id) break;
      inFlight.current++;
      setPhotos((prev) => {
        const photo = prev.find((p) => p.id === id);
        if (photo) {
          void processPhoto(photo).finally(() => {
            inFlight.current--;
            pump();
          });
        } else {
          // Photo was removed while queued.
          inFlight.current--;
        }
        return prev;
      });
    }
  }, [processPhoto]);

  const enqueue = useCallback(
    (id: string) => {
      queue.current.push(id);
      pump();
    },
    [pump]
  );

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !shelf) return;
      const items: PhotoItem[] = [];
      for (const file of Array.from(files)) {
        // Images only — filtered here instead of an accept attribute, which
        // makes iOS add a redundant "Take Photo" entry to its action sheet.
        if (!file.type.startsWith('image/')) continue;
        const id = nanoid();
        items.push({
          id,
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'pending',
        });
        if (outboxSupported()) {
          await outboxPut({
            id,
            shelfId: shelf.id,
            blob: file,
            createdAt: Date.now(),
          }).catch(() => {});
        }
      }
      if (items.length === 0) return;
      setPhotos((prev) => [...prev, ...items]);
      for (const it of items) enqueue(it.id);
    },
    [shelf, enqueue]
  );

  const retryPhoto = useCallback(
    (id: string) => {
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'pending' } : p))
      );
      enqueue(id);
    },
    [enqueue]
  );

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    queue.current = queue.current.filter((qid) => qid !== id);
    if (outboxSupported()) void outboxDelete(id).catch(() => {});
  }, []);

  const toggleRemove = useCallback((key: string) => {
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // --- Camera viewport (getUserMedia with scanner theatre) ---

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setCamera('closed');
  }, []);

  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCamera('live');
    } catch (err) {
      setCamera(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'denied'
          : 'unavailable'
      );
    }
  }, []);

  useEffect(() => {
    if (camera === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [camera]);

  useEffect(
    () => () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    },
    []
  );

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        void addFiles([
          new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }),
        ]);
      },
      'image/jpeg',
      0.92
    );
  }, [addFiles]);

  // --- Save (SSE progress) ---

  const save = useCallback(async () => {
    if (!shelf || visibleProducts.length === 0) return;
    setSaving(true);
    setSaveSteps([]);
    setSaveResult(null);
    try {
      const donePhotos = photos.filter(
        (p) => p.status === 'done' && p.storageKey
      );
      const res = await fetch('/api/store/staff/scan/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shelfId: shelf.id,
          products: visibleProducts.map((p) => ({
            canonicalName: p.name,
            category: p.category ?? null,
            thumbnailDataUrl: p.thumbnailDataUrl,
          })),
          photos: donePhotos.map((p) => ({
            storageKey: p.storageKey,
            detectedCount: p.productCount ?? 0,
          })),
        }),
      });
      if (!res.ok || !res.body) throw new Error('save_failed');

      // The save route streams its pipeline as SSE frames: step events while
      // it works (shown as the "how it's remembering" panel), then done/error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: { created: number; updated: number } | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          sep = buffer.indexOf('\n\n');
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === 'step') {
            setSaveSteps((prev) => {
              const idx = prev.findIndex((s) => s.key === payload.key);
              if (idx === -1 && payload.status === 'start') {
                return [
                  ...prev,
                  {
                    key: payload.key,
                    labelEn: payload.labelEn,
                    labelZh: payload.labelZh,
                    done: false,
                    startedAt: Date.now(),
                  },
                ];
              }
              if (idx !== -1 && payload.status === 'done') {
                return prev.map((s, i) =>
                  i === idx
                    ? { ...s, done: true, ms: Date.now() - s.startedAt }
                    : s
                );
              }
              return prev;
            });
          } else if (event === 'done') {
            result = payload;
          } else if (event === 'error') {
            throw new Error('save_failed');
          }
        }
      }
      if (!result) throw new Error('save_failed');
      setSaveResult(result);
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
      setPhotos([]);
      setRemovedKeys(new Set());
    } catch {
      setSaveSteps([]);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }, [shelf, visibleProducts, photos, t]);

  const scanAnother = useCallback(() => {
    setSaveResult(null);
    setSaveSteps([]);
    stopCamera();
    setShelf(shelves.length === 1 ? shelves[0] : null);
  }, [shelves, stopCamera]);

  if (shelves.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">{t('empty')}</p>
    );
  }

  // --- Shelf picker (tap the floor map when one is published, wherebear-style) ---
  if (!shelf) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h2 className="font-semibold text-xl">{t('pickShelf')}</h2>
          <p className="text-muted-foreground text-sm">
            {mapJson ? t('pickOnMap') : t('shelfPickerHint')}
          </p>
        </div>
        {mapJson ? (
          <>
            <StoreMapSvg
              mapJson={mapJson}
              onSelectShelf={(code) => {
                const picked = shelves.find((s) => s.code === code);
                if (picked) setShelf(picked);
              }}
            />
            <p className="text-center text-muted-foreground text-xs">
              {t('orFromList')}
            </p>
          </>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shelves.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setShelf(s)}
              className="flex min-h-20 flex-col items-center justify-center rounded-xl border p-3 hover:border-primary hover:bg-accent"
            >
              <span className="font-bold text-2xl">{s.code}</span>
              {s.label ? (
                <span className="text-muted-foreground text-sm">{s.label}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Save button as a state machine (wherebear-style status text) ---
  let saveLabel: string;
  let saveDisabled = false;
  if (totalPhotos === 0) {
    saveLabel = t('addPhotoFirst');
    saveDisabled = true;
  } else if (readingCount > 0) {
    saveLabel = t('readingShelf', {
      done: doneCount + failedCount,
      total: totalPhotos,
    });
    saveDisabled = true;
  } else if (visibleProducts.length === 0) {
    saveLabel = merged.length === 0 ? t('tryClearer') : t('nothingToSave');
    saveDisabled = true;
  } else {
    saveLabel = t('saveCount', {
      count: visibleProducts.length,
      code: shelf.code,
    });
  }

  // --- Scan surface ---
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-lg">
            {t('atShelf', { code: shelf.code })}
          </span>
          {shelf.label ? (
            <span className="ml-2 text-muted-foreground">{shelf.label}</span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            stopCamera();
            setShelf(null);
          }}
        >
          {t('changeShelf')}
        </Button>
      </div>

      <input
        ref={libraryRef}
        type="file"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          size="lg"
          className="h-14 text-base"
          onClick={() => (camera === 'closed' ? openCamera() : stopCamera())}
        >
          <CameraIcon className="mr-2 size-5" /> {t('takePhoto')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-14 text-base"
          onClick={() => libraryRef.current?.click()}
        >
          <ImageIcon className="mr-2 size-5" /> {t('fromLibrary')}
        </Button>
      </div>

      {camera !== 'closed' ? (
        <div
          className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl bg-black"
          style={{ aspectRatio: '3 / 4', maxHeight: '70vh' }}
        >
          {camera === 'live' ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 size-full object-cover"
              />
              <span className="absolute top-4 left-4 size-8 rounded-tl-xl border-white/80 border-t-2 border-l-2" />
              <span className="absolute top-4 right-4 size-8 rounded-tr-xl border-white/80 border-t-2 border-r-2" />
              <span className="absolute bottom-4 left-4 size-8 rounded-bl-xl border-white/80 border-b-2 border-l-2" />
              <span className="absolute right-4 bottom-4 size-8 rounded-br-xl border-white/80 border-r-2 border-b-2" />
              <div className="wa-scanline">
                <div
                  className="h-0.5 rounded-full bg-emerald-300/90"
                  style={{ boxShadow: '0 0 12px 3px rgba(110,231,183,0.7)' }}
                />
              </div>
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
                }}
              />
              <p className="absolute inset-x-0 top-5 text-center text-sm text-white/85">
                {t('holdSteady')}
              </p>
              <button
                type="button"
                onClick={captureFrame}
                aria-label={t('capture')}
                className="-translate-x-1/2 absolute bottom-6 left-1/2 size-16 rounded-full border-4 border-white bg-white/30 transition active:scale-90"
              />
            </>
          ) : camera === 'starting' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85">
              <Loader2Icon className="size-6 animate-spin" />
              <p className="text-sm">{t('cameraStarting')}</p>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/85">
              <p className="font-medium">
                {camera === 'denied'
                  ? t('cameraDenied')
                  : t('cameraUnavailable')}
              </p>
              <p className="text-sm text-white/60">{t('cameraHint')}</p>
              <Button size="sm" variant="secondary" onClick={openCamera}>
                <RotateCcwIcon className="mr-1 size-4" /> {t('retry')}
              </Button>
            </div>
          )}
          <button
            type="button"
            onClick={stopCamera}
            aria-label={t('closeCamera')}
            className="absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {t('photosProgress', { done: doneCount, total: totalPhotos })}
              {failedCount > 0 ? (
                <span className="text-red-600">
                  {' · '}
                  {t('photosFailed', { count: failedCount })}
                </span>
              ) : null}
            </span>
            {readingCount > 0 ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {t('reading', { count: readingCount })}
              </span>
            ) : null}
          </div>
          {/* Determinate progress + indeterminate sweep so it never looks stuck */}
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${((doneCount + failedCount) / totalPhotos) * 100}%`,
              }}
            />
            {readingCount > 0 ? (
              <div className="wa-sweep absolute inset-y-0 w-1/3 rounded-full bg-primary/25" />
            ) : null}
          </div>
          <div className="flex gap-3 overflow-x-auto pt-1 pb-1">
            {photos.map((p) => (
              <div key={p.id} className="relative size-20 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt=""
                  className="size-full rounded-lg border object-cover"
                />
                {p.status === 'pending' ? (
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                    <Loader2Icon className="size-5 animate-spin text-white" />
                  </span>
                ) : null}
                {p.status === 'recognizing' ? (
                  <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/35">
                    <div className="wa-sweep h-full w-1/2 rounded-full bg-white/85" />
                  </div>
                ) : null}
                {p.status === 'done' ? (
                  <span className="absolute right-1 bottom-1 rounded-full bg-black/60 px-1.5 font-semibold text-white text-xs">
                    {p.productCount}
                  </span>
                ) : null}
                {p.status === 'failed' ? (
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/35 font-bold text-lg text-white">
                    !
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    p.status === 'failed' ? retryPhoto(p.id) : removePhoto(p.id)
                  }
                  aria-label={
                    p.status === 'failed' ? t('retry') : t('removePhoto')
                  }
                  className="-right-1.5 -top-1.5 absolute flex size-6 items-center justify-center rounded-full border bg-background shadow"
                >
                  {p.status === 'failed' ? (
                    <RotateCcwIcon className="size-3" />
                  ) : (
                    <XIcon className="size-3" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 font-medium">
          {merged.length > 0
            ? t('foundProducts', { count: visibleProducts.length })
            : t('noProductsYet')}
        </h3>
        {readingCount > 0 && merged.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="wa-shimmer h-16 rounded-lg border bg-muted/40"
              />
            ))}
            <p className="pt-1 text-center text-muted-foreground text-sm">
              {t('readingPhotos', { count: readingCount })}
            </p>
          </div>
        ) : null}
        {readingCount === 0 && totalPhotos > 0 && merged.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('nothingDetected', { count: totalPhotos })}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {merged.map((p) => {
            const subtitle = [p.nameZh, p.category, p.confidence]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={p.key}
                className={`flex items-center gap-3 rounded-lg border p-2 ${
                  p.removed ? 'opacity-40' : ''
                }`}
              >
                {p.thumbnailDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnailDataUrl}
                    alt=""
                    className="size-12 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded bg-muted">
                    <ImageIcon className="size-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  {subtitle ? (
                    <p className="truncate text-muted-foreground text-sm">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleRemove(p.key)}
                >
                  {p.removed ? t('removed') : t('removeProduct')}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {saving || saveResult ? (
        <div className="rounded-xl border p-4">
          <h3 className="mb-3 font-medium">
            {saveResult ? t('savedTitle') : t('savingTitle')}
          </h3>
          <ul className="flex flex-col gap-2">
            {saveSteps.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                {s.done ? (
                  <CheckCircle2Icon className="size-4 shrink-0 text-green-600" />
                ) : (
                  <Loader2Icon className="size-4 shrink-0 animate-spin" />
                )}
                <span className={s.done ? '' : 'animate-pulse'}>
                  {locale === 'zh' ? s.labelZh : s.labelEn}
                </span>
                {s.ms !== undefined ? (
                  <span className="ml-auto font-mono text-muted-foreground text-xs">
                    {s.ms}ms
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {saveResult ? (
            <>
              <p className="mt-3 font-semibold">
                {t('savedStats', {
                  created: saveResult.created,
                  updated: saveResult.updated,
                })}
              </p>
              <Button size="lg" className="mt-3 w-full" onClick={scanAnother}>
                {t('scanAnother')}
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <Button
          size="lg"
          className="h-14 text-lg"
          onClick={save}
          disabled={saveDisabled}
        >
          {saveLabel}
        </Button>
      )}
    </div>
  );
}
