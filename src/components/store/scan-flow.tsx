'use client';

import { Button } from '@/components/ui/button';
import { outboxDelete, outboxPut, outboxSupported } from '@/lib/scan-outbox';
import {
  CameraIcon,
  CheckCircle2Icon,
  ImageIcon,
  Loader2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { nanoid } from 'nanoid';
import { useCallback, useRef, useState } from 'react';
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
  facesBlurred?: number;
  productCount?: number;
}

interface MergedProduct extends DetectedProduct {
  key: string;
  removed: boolean;
}

const MAX_CONCURRENT = 2;

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ScanFlow({ shelves }: { shelves: Shelf[] }) {
  const t = useTranslations('Store.staff.scan');
  const [shelf, setShelf] = useState<Shelf | null>(
    shelves.length === 1 ? shelves[0] : null
  );
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [products, setProducts] = useState<MergedProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(0);
  const queue = useRef<string[]>([]);

  const mergeProducts = useCallback((incoming: DetectedProduct[]) => {
    setProducts((prev) => {
      const byKey = new Map(prev.map((p) => [p.key, p]));
      for (const d of incoming) {
        const key = normalizeKey(d.name);
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          // Keep a thumbnail if we didn't have one yet.
          if (!existing.thumbnailDataUrl && d.thumbnailDataUrl) {
            byKey.set(key, {
              ...existing,
              thumbnailDataUrl: d.thumbnailDataUrl,
            });
          }
        } else {
          byKey.set(key, { ...d, key, removed: false });
        }
      }
      return Array.from(byKey.values());
    });
  }, []);

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
        mergeProducts(data.products ?? []);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id
              ? {
                  ...p,
                  status: 'done',
                  storageKey: data.storageKey,
                  facesBlurred: data.facesBlurred,
                  productCount: (data.products ?? []).length,
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
    [shelf, mergeProducts]
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
    async (files: FileList | null) => {
      if (!files || !shelf) return;
      const items: PhotoItem[] = [];
      for (const file of Array.from(files)) {
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

  const toggleRemove = useCallback((key: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.key === key ? { ...p, removed: !p.removed } : p))
    );
  }, []);

  const visibleProducts = products.filter((p) => !p.removed);

  const save = useCallback(async () => {
    if (!shelf || visibleProducts.length === 0) return;
    setSaving(true);
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
            facesBlurred: p.facesBlurred ?? 0,
            detectedCount: p.productCount ?? 0,
          })),
        }),
      });
      if (!res.ok) throw new Error('save_failed');
      const data = await res.json();
      toast.success(
        t('saved', { created: data.created, updated: data.updated })
      );
      setPhotos([]);
      setProducts([]);
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }, [shelf, visibleProducts, photos, t]);

  if (shelves.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">{t('empty')}</p>
    );
  }

  // --- Shelf picker ---
  if (!shelf) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h2 className="font-semibold text-xl">{t('pickShelf')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('shelfPickerHint')}
          </p>
        </div>
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
        <Button variant="ghost" size="sm" onClick={() => setShelf(null)}>
          {t('changeShelf')}
        </Button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          size="lg"
          className="h-14 text-base"
          onClick={() => cameraRef.current?.click()}
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

      {photos.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => p.status === 'failed' && retryPhoto(p.id)}
              className="relative size-16 shrink-0 overflow-hidden rounded-lg border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                className="size-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                {p.status === 'recognizing' || p.status === 'pending' ? (
                  <Loader2Icon className="size-5 animate-spin text-white" />
                ) : p.status === 'done' ? (
                  <CheckCircle2Icon className="size-5 text-green-400" />
                ) : (
                  <XIcon className="size-5 text-red-400" />
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 font-medium">
          {products.length > 0
            ? t('foundProducts', { count: visibleProducts.length })
            : t('noProductsYet')}
        </h3>
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
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
                {p.nameZh ? (
                  <p className="truncate text-muted-foreground text-sm">
                    {p.nameZh}
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
          ))}
        </ul>
      </div>

      {visibleProducts.length > 0 ? (
        <Button
          size="lg"
          className="h-14 text-lg"
          onClick={save}
          disabled={saving}
        >
          {saving ? t('saving') : t('save')}
        </Button>
      ) : null}
    </div>
  );
}
