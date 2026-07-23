import 'server-only';

import { productRepo } from '@/data/product-repo';
import { getStorageProvider } from '@/storage';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { type ProductAliases, generateAliasesBatch } from './aliases';
import { embedDocuments } from './embeddings';
import { EMBED_MODEL, GEN_MODEL } from './models';
import {
  READOUT_MODEL,
  ROW_DETECT_MODEL,
  SCAN_MODEL,
  isScanConfigured,
} from './scan/config';
import { ScanFailedError, detectBoxes, detectRowBands } from './scan/detect';
import { cropRect } from './scan/grid';
import { type PreparedScanImages, prepareScanImages } from './scan/image';
import { applyReadoutNames, extractEntries } from './scan/names';
import { sumTokens } from './scan/openrouter';
import { readProductNames } from './scan/readout';
import type { NormalizedBox, PreparedImage } from './scan/types';
import { stubScanBoxes } from './stub';
import { recordUsage } from './usage';

/** One reviewed product detected on a shelf photo. */
export interface ScannedProduct {
  name: string;
  /** 240px JPEG data URL cropped to the product's largest box. */
  thumbnailDataUrl?: string;
  /** How many separate spots this product was detected in on the photo. */
  count: number;
  /** Fractional bounding box (0-1) of the largest detection. */
  box: NormalizedBox;
}

/** Crop a box (with context padding) to a 240px JPEG data URL. */
async function makeThumbnail(
  source: PreparedImage,
  box: NormalizedBox
): Promise<string | undefined> {
  try {
    const rect = cropRect(box, source.width, source.height);
    const buf = await sharp(source.jpeg)
      .extract(rect)
      .resize(240, 240, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn('[scan] thumbnail crop failed:', err);
    return undefined;
  }
}

async function boxesToProducts(
  boxes: NormalizedBox[],
  thumbSource: PreparedImage
): Promise<ScannedProduct[]> {
  const entries = extractEntries(boxes);
  return Promise.all(
    entries.map(async (e) => {
      const largest = e.boxIndices.reduce((best, i) =>
        boxes[i].w * boxes[i].h > boxes[best].w * boxes[best].h ? i : best
      );
      const box = boxes[largest];
      return {
        name: e.name,
        thumbnailDataUrl: await makeThumbnail(thumbSource, box),
        count: e.count,
        box,
      };
    })
  );
}

/** Offline stub: fake boxes over the real upload, so thumbnails still work. */
async function stubScan(
  photoId: string,
  images: PreparedScanImages
): Promise<ScannedProduct[]> {
  const boxes: NormalizedBox[] = stubScanBoxes(photoId);
  return boxesToProducts(boxes, images.processed);
}

/**
 * Process one shelf photo with the rows-hd engine (benchmarked champion,
 * ported from whataisle-readshelf): EXIF-normalize → persist → detect shelf
 * rows → band detection from the full-resolution image → grid readout
 * re-reads each box's name from its high-res crop. Returns the deduped
 * detected products (with thumbnail data URLs) for the staff to review
 * before saving. This is the per-photo unit — one photo failing never blocks
 * the batch (each is processed independently).
 */
export async function processShelfPhoto(input: {
  storeId: string;
  shelfId: string;
  shelfContext?: string;
  imageBuffer: Buffer;
  photoId: string;
}): Promise<{
  storageKey: string;
  products: ScannedProduct[];
}> {
  const images = await prepareScanImages(input.imageBuffer);

  // Persist the EXIF-normalized processed image (nothing else is stored).
  const storageKey = `stores/${input.storeId}/shelf-photos/${input.photoId}.jpg`;
  await getStorageProvider().put({
    key: storageKey,
    data: images.processed.jpeg,
    contentType: 'image/jpeg',
    cacheControl: 'private, no-store',
  });

  if (!isScanConfigured()) {
    return { storageKey, products: await stubScan(input.photoId, images) };
  }

  // Stage 0: shelf rows → gap-free bands (degrades to one band on failure).
  const rows = await detectRowBands(images.processed);
  if (rows.outcome) {
    const t = rows.outcome.tokens;
    await recordUsage({
      storeId: input.storeId,
      kind: 'scan_rows',
      model: ROW_DETECT_MODEL,
      usage: {
        inputTokens: t?.prompt ?? 0,
        outputTokens: t?.completion ?? 0,
        images: 1,
      },
      latencyMs: rows.outcome.latencyMs,
      refId: input.photoId,
    });
  }
  if (rows.warning) console.warn(`[scan] ${input.photoId}: ${rows.warning}`);

  // Stage 1: rows-hd band detection at full reasoning (the reasoning is the
  // source of correct product grouping — do not lower it here).
  const detStarted = Date.now();
  let det: Awaited<ReturnType<typeof detectBoxes>>;
  try {
    det = await detectBoxes(images.full, rows.bands);
  } catch (err) {
    if (err instanceof ScanFailedError) {
      const t = sumTokens(err.outcomes);
      await recordUsage({
        storeId: input.storeId,
        kind: 'scan_detect',
        model: SCAN_MODEL,
        usage: {
          inputTokens: t.prompt,
          outputTokens: t.completion,
          images: err.outcomes.length,
        },
        latencyMs: Date.now() - detStarted,
        refId: input.photoId,
      });
    }
    throw err;
  }
  const detTokens = sumTokens(det.outcomes);
  await recordUsage({
    storeId: input.storeId,
    kind: 'scan_detect',
    model: SCAN_MODEL,
    usage: {
      inputTokens: detTokens.prompt,
      outputTokens: detTokens.completion,
      images: det.outcomes.length,
    },
    latencyMs: det.latencyMs,
    refId: input.photoId,
  });

  // Stage 2: grid readout fixes copy-paste mislabels from band detection.
  const readout = await readProductNames(images.full, det.boxes);
  if (readout.outcomes.length > 0) {
    const roTokens = sumTokens(readout.outcomes);
    await recordUsage({
      storeId: input.storeId,
      kind: 'scan_readout',
      model: READOUT_MODEL,
      usage: {
        inputTokens: roTokens.prompt,
        outputTokens: roTokens.completion,
        images: readout.outcomes.length,
      },
      latencyMs: readout.latencyMs,
      refId: input.photoId,
    });
  }

  const labeled = applyReadoutNames(det.boxes, readout.names);
  const products = await boxesToProducts(labeled, images.full);
  return { storageKey, products };
}

/** Build the "canonical · aliases" search text used for embedding + trigram. */
function buildSearchText(
  canonicalName: string,
  nameZh: string | null,
  aliases: ProductAliases
): string {
  const parts = [
    canonicalName,
    nameZh,
    ...aliases.en,
    ...aliases.zh,
    ...aliases.pinyin,
    ...aliases.misspelling,
  ].filter((s): s is string => Boolean(s && s.trim()));
  return Array.from(new Set(parts)).join(' · ');
}

function toAliasRows(
  canonicalName: string,
  aliases: ProductAliases
): Array<{ alias: string; lang: string; source: string }> {
  const rows: Array<{ alias: string; lang: string; source: string }> = [];
  const seen = new Set<string>([canonicalName.toLowerCase()]);
  const push = (alias: string, lang: string) => {
    const key = alias.toLowerCase();
    if (!alias.trim() || seen.has(key)) return;
    seen.add(key);
    rows.push({ alias, lang, source: 'ai' });
  };
  for (const a of aliases.en) push(a, 'en');
  for (const a of aliases.zh) push(a, 'zh');
  for (const a of aliases.pinyin) push(a, 'pinyin');
  for (const a of aliases.misspelling) push(a, 'misspelling');
  return rows;
}

export interface ProductToSave {
  canonicalName: string;
  category?: string | null;
  /** 240px JPEG data URL from the scan; persisted as the thumbnail. */
  thumbnailDataUrl?: string | null;
}

/** Pipeline stages streamed to the staff UI while a scan batch saves. */
export type SaveStepKey = 'aliases' | 'embed' | 'save';

/**
 * Save reviewed products to store memory: generate aliases + embeddings,
 * persist thumbnails, upsert products (bumping evidence count), and record
 * each on the shelf (seen N×). onStep fires at each stage boundary so the
 * save route can stream progress.
 */
export async function saveScannedProducts(input: {
  storeId: string;
  shelfId: string;
  shelfContext?: string;
  products: ProductToSave[];
  onStep?: (key: SaveStepKey, status: 'start' | 'done') => void;
}): Promise<{ saved: number; created: number; updated: number }> {
  const onStep = input.onStep ?? (() => {});
  const repo = productRepo(input.storeId);
  const names = input.products
    .map((p) => p.canonicalName.trim())
    .filter(Boolean);
  if (names.length === 0) return { saved: 0, created: 0, updated: 0 };

  const started = Date.now();
  onStep('aliases', 'start');
  const { aliasesByName, usage: aliasUsage } = await generateAliasesBatch(
    names,
    {
      shelfContext: input.shelfContext,
    }
  );
  await recordUsage({
    storeId: input.storeId,
    kind: 'alias',
    model: GEN_MODEL,
    usage: aliasUsage,
    latencyMs: Date.now() - started,
  });
  onStep('aliases', 'done');

  // Build search texts and embed them in one batch.
  const prepared = input.products.map((p) => {
    const aliases = aliasesByName[p.canonicalName.trim()] ?? {
      en: [],
      zh: [],
      pinyin: [],
      misspelling: [],
      nameZh: null,
    };
    const searchText = buildSearchText(
      p.canonicalName,
      aliases.nameZh,
      aliases
    );
    return { product: p, aliases, searchText };
  });

  const embStarted = Date.now();
  onStep('embed', 'start');
  const embeddings = await embedDocuments(prepared.map((p) => p.searchText));
  await recordUsage({
    storeId: input.storeId,
    kind: 'embed',
    model: EMBED_MODEL,
    usage: { images: 0, inputTokens: 0, outputTokens: 0 },
    latencyMs: Date.now() - embStarted,
  });
  onStep('embed', 'done');

  onStep('save', 'start');
  let created = 0;
  let updated = 0;
  for (let i = 0; i < prepared.length; i++) {
    const { product: p, aliases, searchText } = prepared[i];
    const embedding = embeddings[i];

    // Persist the cropped thumbnail (cropped to the product area — §10).
    let thumbnailKey: string | null = null;
    if (p.thumbnailDataUrl?.startsWith?.('data:')) {
      const b64 = p.thumbnailDataUrl.split(',')[1] ?? '';
      if (b64) {
        thumbnailKey = `stores/${input.storeId}/thumbnails/${nanoid()}.jpg`;
        await getStorageProvider().put({
          key: thumbnailKey,
          data: Buffer.from(b64, 'base64'),
          contentType: 'image/jpeg',
          cacheControl: 'private, max-age=31536000, immutable',
        });
      }
    }

    const res = await repo.upsertFromScan({
      canonicalName: p.canonicalName.trim(),
      nameZh: aliases.nameZh,
      category: p.category ?? null,
      searchText,
      embedding,
      thumbnailKey,
      aliases: toAliasRows(p.canonicalName.trim(), aliases),
      shelfId: input.shelfId,
    });
    if (res.created) created++;
    else updated++;
  }
  onStep('save', 'done');

  // Clear any open misses that these newly-saved products now answer (§4.3).
  try {
    const { insightsRepo } = await import('@/data/insights-repo');
    await insightsRepo(input.storeId).clearMissesMatching(names);
  } catch (err) {
    console.warn('[scan] clearing misses failed:', err);
  }

  return { saved: prepared.length, created, updated };
}
