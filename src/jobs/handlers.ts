import 'server-only';

import { embedDocuments } from '@/ai/embeddings';
import { isAiConfigured } from '@/ai/client';
import { EMBED_MODEL } from '@/ai/models';
import { recordUsage } from '@/ai/usage';
import { getDb } from '@/db';
import { product } from '@/db/store.schema';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { type JobResult, registerJobHandler } from './queue';

/** Products per chunk. Small enough that one chunk fits a tick comfortably. */
const PAGE_SIZE = 50;

interface ReEmbedPayload {
  storeId: string;
  /** Last product id processed; '' starts from the beginning. */
  cursor?: string;
  embedded?: number;
  skipped?: number;
}

/**
 * Re-embed one store's catalog, a page at a time.
 *
 * The route version walked every store × every product in a single request
 * under a 300s cap and returned no cursor, so a timeout lost all progress for
 * the store in flight and there was no way to resume. As a job each page is
 * committed before the next is claimed, so a timeout costs one page.
 */
async function reEmbedStore(payload: ReEmbedPayload): Promise<JobResult> {
  // Stub embeddings would overwrite real vectors with hash noise — the same
  // guard the route has, repeated because a job can outlive the config that
  // enqueued it.
  if (!isAiConfigured()) throw new Error('ai_not_configured');

  const db = await getDb();
  const started = Date.now();
  const cursor = payload.cursor ?? '';

  const page = await db
    .select({ id: product.id, searchText: product.searchText })
    .from(product)
    .where(
      and(
        eq(product.storeId, payload.storeId),
        ne(product.status, 'deleted'),
        gt(product.id, cursor)
      )
    )
    .orderBy(asc(product.id))
    .limit(PAGE_SIZE);

  if (page.length === 0) {
    console.log(
      `[jobs] re-embed ${payload.storeId} complete: ` +
        `${payload.embedded ?? 0} embedded, ${payload.skipped ?? 0} skipped`
    );
    return { status: 'done' };
  }

  const vectors = await embedDocuments(page.map((p) => p.searchText || p.id));
  let embedded = payload.embedded ?? 0;
  let skipped = payload.skipped ?? 0;

  for (let i = 0; i < page.length; i++) {
    // Skip rather than write: a null means the provider dropped this text,
    // and overwriting a good vector on that basis is a silent downgrade.
    if (vectors[i] === null) {
      skipped++;
      continue;
    }
    await db
      .update(product)
      .set({ embedding: vectors[i], updatedAt: new Date() })
      .where(eq(product.id, page[i].id));
    embedded++;
  }

  await recordUsage({
    storeId: payload.storeId,
    kind: 'embed',
    model: EMBED_MODEL,
    usage: { images: 0, inputTokens: 0, outputTokens: 0 },
    latencyMs: Date.now() - started,
  });

  return {
    status: 'reschedule',
    payload: {
      ...payload,
      cursor: page[page.length - 1].id,
      embedded,
      skipped,
    } satisfies ReEmbedPayload,
  };
}

let registered = false;

/**
 * Register every handler. Called by the tick route rather than at module load
 * so the map is populated in whatever runtime actually runs jobs.
 */
export function registerHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler('product_enrichment', (job) =>
    reEmbedStore(job.payload as ReEmbedPayload)
  );
}
