import { embedDocuments } from '@/ai/embeddings';
import { isAiConfigured } from '@/ai/client';
import { EMBED_MODEL } from '@/ai/models';
import { recordUsage } from '@/ai/usage';
import { getDb } from '@/db';
import { product, store } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const PAGE_SIZE = 50;

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
 * Re-embed every product's search_text with the current embedding model —
 * founder/admin only. Required whenever the embedding model changes: vectors
 * from different models live in different spaces, so stale rows return noise
 * on the vector leg until re-embedded. Also fills missing embeddings.
 * Idempotent; safe to re-run.
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

  let products = 0;
  const failures: string[] = [];

  for (const s of stores) {
    const started = Date.now();
    let embedded = 0;
    try {
      let cursor = '';
      for (;;) {
        const page = await db
          .select({ id: product.id, searchText: product.searchText })
          .from(product)
          .where(
            and(
              eq(product.storeId, s.id),
              ne(product.status, 'deleted'),
              gt(product.id, cursor)
            )
          )
          .orderBy(asc(product.id))
          .limit(PAGE_SIZE);
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;

        const vectors = await embedDocuments(
          page.map((p) => p.searchText || p.id)
        );
        for (let i = 0; i < page.length; i++) {
          await db
            .update(product)
            .set({ embedding: vectors[i], updatedAt: new Date() })
            .where(eq(product.id, page[i].id));
        }
        embedded += page.length;
      }
      if (embedded > 0) {
        await recordUsage({
          storeId: s.id,
          kind: 'embed',
          model: EMBED_MODEL,
          usage: { images: 0, inputTokens: 0, outputTokens: 0 },
          latencyMs: Date.now() - started,
        });
      }
    } catch (err) {
      console.error(`[re-embed] store ${s.id} failed:`, err);
      failures.push(s.id);
    }
    products += embedded;
  }

  return NextResponse.json({ stores: stores.length, products, failures });
}
