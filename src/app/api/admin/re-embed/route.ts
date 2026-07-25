import { isAiConfigured } from '@/ai/client';
import { getDb } from '@/db';
import { store } from '@/db/store.schema';
import { enqueueJob } from '@/jobs/queue';
import { getSession } from '@/lib/server';
import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Deploy automation escape hatch: ADMIN_TASK_TOKEN (when set) authorizes a
 * `Authorization: Bearer <token>` call without a browser session, so the
 * post-deploy pipeline can trigger re-embedding. Unset env disables it.
 */
function bearerAuthorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TASK_TOKEN;
  const header = req.headers.get('authorization');
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Queue a re-embed of every product's search_text with the current embedding
 * model — founder/admin only. Required whenever the embedding model changes:
 * vectors from different models live in different spaces, so stale rows
 * return noise on the vector leg until re-embedded.
 *
 * This used to do the work inline: every store × every product in one request
 * under a 300s cap, with no cursor returned. A timeout lost all progress for
 * the store in flight and there was no way to resume, so a catalog past a
 * certain size simply could not be re-embedded. It now enqueues one job per
 * store; each job walks its catalog a page at a time, committing as it goes,
 * so a timeout costs one page.
 *
 * Idempotent twice over: the idempotency key is (store, model), so re-running
 * while a pass is in flight is a no-op, and the work itself is safe to repeat.
 */
export async function POST(req: NextRequest) {
  if (!bearerAuthorized(req)) {
    const session = await getSession();
    if (session?.user?.role !== 'admin') {
      return new NextResponse(null, { status: 403 });
    }
  }
  if (!isAiConfigured()) {
    // Stub embeddings would overwrite real vectors with hash noise.
    return NextResponse.json({ error: 'ai_not_configured' }, { status: 409 });
  }

  const db = await getDb();
  const stores = await db.select({ id: store.id }).from(store);
  const model = process.env.QWEN_EMBED_MODEL ?? 'text-embedding-v4';

  let queued = 0;
  let alreadyQueued = 0;
  for (const s of stores) {
    const id = await enqueueJob({
      type: 'product_enrichment',
      // Scoped to the model so changing models queues a fresh pass, while a
      // double-fire for the same model collapses into one.
      idempotencyKey: `re-embed:${s.id}:${model}`,
      storeId: s.id,
      payload: { storeId: s.id },
    });
    if (id) queued++;
    else alreadyQueued++;
  }

  return NextResponse.json({ stores: stores.length, queued, alreadyQueued });
}
