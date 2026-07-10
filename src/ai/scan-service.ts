import 'server-only';

import { productRepo } from '@/data/product-repo';
import { nanoid } from 'nanoid';
import { getStorageProvider } from '@/storage';
import { type ProductAliases, generateAliasesBatch } from './aliases';
import { blurFaces } from './face-blur';
import { embedDocuments } from './embeddings';
import { GEN_MODEL, EMBED_MODEL } from './models';
import { recordUsage } from './usage';
import { type DetectedProduct, detectShelfProducts } from './vision-shelf';

/**
 * Process one shelf photo: blur faces, persist the photo, run vision, and
 * return the deduped detected products (with thumbnail data URLs) for the
 * staff to review before saving. This is the per-photo unit — one photo
 * failing never blocks the batch (each is processed independently).
 */
export async function processShelfPhoto(input: {
  storeId: string;
  shelfId: string;
  shelfContext?: string;
  imageBuffer: Buffer;
  photoId: string;
}): Promise<{
  storageKey: string;
  facesBlurred: number;
  products: DetectedProduct[];
}> {
  const started = Date.now();
  const vision = await detectShelfProducts(input.imageBuffer, {
    shelfContext: input.shelfContext,
    stubSeed: input.photoId,
  });

  await recordUsage({
    storeId: input.storeId,
    kind: 'vision_stage1',
    model: GEN_MODEL,
    usage: vision.usage,
    latencyMs: Date.now() - started,
    refId: input.photoId,
  });

  // Blur faces BEFORE persisting; original bytes are never written.
  const { buffer: safeBuffer, blurredCount } = await blurFaces(
    input.imageBuffer,
    vision.faces
  );
  const storageKey = `stores/${input.storeId}/shelf-photos/${input.photoId}.jpg`;
  await getStorageProvider().put({
    key: storageKey,
    data: safeBuffer,
    contentType: 'image/jpeg',
    cacheControl: 'private, no-store',
  });

  return { storageKey, facesBlurred: blurredCount, products: vision.products };
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
  /** 240px JPEG data URL from vision; persisted to storage as the thumbnail. */
  thumbnailDataUrl?: string | null;
}

/**
 * Save reviewed products to store memory: generate aliases + embeddings,
 * persist thumbnails, upsert products (bumping evidence count), and record
 * each on the shelf (seen N×).
 */
export async function saveScannedProducts(input: {
  storeId: string;
  shelfId: string;
  shelfContext?: string;
  products: ProductToSave[];
}): Promise<{ saved: number; created: number; updated: number }> {
  const repo = productRepo(input.storeId);
  const names = input.products
    .map((p) => p.canonicalName.trim())
    .filter(Boolean);
  if (names.length === 0) return { saved: 0, created: 0, updated: 0 };

  const started = Date.now();
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
  const embeddings = await embedDocuments(prepared.map((p) => p.searchText));
  await recordUsage({
    storeId: input.storeId,
    kind: 'embed',
    model: EMBED_MODEL,
    usage: { images: 0, inputTokens: 0, outputTokens: 0 },
    latencyMs: Date.now() - embStarted,
  });

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

  // Clear any open misses that these newly-saved products now answer (§4.3).
  try {
    const { insightsRepo } = await import('@/data/insights-repo');
    await insightsRepo(input.storeId).clearMissesMatching(names);
  } catch (err) {
    console.warn('[scan] clearing misses failed:', err);
  }

  return { saved: prepared.length, created, updated };
}
