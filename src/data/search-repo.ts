import 'server-only';

import { getDb } from '@/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  type AnswerTone,
  type InputMethod,
  missInsight,
  product,
  productLocation,
  searchLog,
  shelf,
} from '@/db/store.schema';
import { nanoid } from 'nanoid';
import { toVectorLiteral } from './product-repo';

/**
 * Tenant-scoped hybrid retrieval for shopper search.
 *
 * Two independent ranked lists over this store's active products:
 *   - vector: cosine similarity on the product embedding (semantic)
 *   - lexical: pg_trgm similarity on search_text + aliases (typos, partials)
 * fused with Reciprocal Rank Fusion, then boosted by the "seen N×" trust
 * signal. All queries bind store_id, so a shopper never sees another store.
 */

export interface Candidate {
  productId: string;
  canonicalName: string;
  nameZh: string | null;
  category: string | null;
  evidenceCount: number;
  confidenceState: 'normal' | 'doubted';
  thumbnailKey: string | null;
  vectorScore: number | null;
  lexicalScore: number | null;
  /** Fused + trust-boosted ranking score. */
  score: number;
  /** Shelves this product is on (code + side + seenCount). */
  locations: Array<{
    locationId: string;
    shelfId: string;
    shelfCode: string;
    side: 'L' | 'R' | null;
    seenCount: number;
  }>;
}

const RRF_K = 60;
const POOL = 10;

export function searchRepo(storeId: string) {
  return {
    async hybridSearch(input: {
      queryText: string;
      /** null when AI is down: search degrades to lexical-only (never blank). */
      queryEmbedding: number[] | null;
    }): Promise<Candidate[]> {
      const db = await getDb();

      // Vector leg: nearest neighbours by cosine distance. Skipped when there
      // is no query embedding (degraded mode).
      const vecRows = input.queryEmbedding
        ? ((await db.execute(sql`
        SELECT id, 1 - (embedding <=> ${toVectorLiteral(input.queryEmbedding)}::vector) AS score
        FROM product
        WHERE store_id = ${storeId}
          AND status = 'active'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${toVectorLiteral(input.queryEmbedding)}::vector
        LIMIT ${POOL}
      `)) as unknown as Array<{ id: string; score: number }>)
        : [];

      // Lexical leg: word-trigram similarity over product search_text and
      // aliases. word_similarity matches the query against the closest span of
      // the target, so "Pocky" matches "Pocky Strawberry · 百奇草莓" and
      // "gochujang" matches a misspelling alias — the way shoppers actually type.
      const q = input.queryText;
      const lexRows = (await db.execute(sql`
        SELECT p.id, GREATEST(
          word_similarity(${q}, p.search_text),
          COALESCE((
            SELECT max(word_similarity(${q}, a.alias))
            FROM product_alias a
            WHERE a.product_id = p.id AND a.store_id = ${storeId}
          ), 0)
        ) AS score
        FROM product p
        WHERE p.store_id = ${storeId}
          AND p.status = 'active'
          AND (
            ${q} <% p.search_text
            OR EXISTS (
              SELECT 1 FROM product_alias a
              WHERE a.product_id = p.id AND a.store_id = ${storeId} AND ${q} <% a.alias
            )
          )
        ORDER BY score DESC
        LIMIT ${POOL}
      `)) as unknown as Array<{ id: string; score: number }>;

      // Reciprocal Rank Fusion.
      const fused = new Map<
        string,
        { rrf: number; vectorScore: number | null; lexicalScore: number | null }
      >();
      vecRows.forEach((r, i) => {
        const e = fused.get(r.id) ?? {
          rrf: 0,
          vectorScore: null,
          lexicalScore: null,
        };
        e.rrf += 1 / (RRF_K + i + 1);
        e.vectorScore = Number(r.score);
        fused.set(r.id, e);
      });
      lexRows.forEach((r, i) => {
        const e = fused.get(r.id) ?? {
          rrf: 0,
          vectorScore: null,
          lexicalScore: null,
        };
        e.rrf += 1 / (RRF_K + i + 1);
        e.lexicalScore = Number(r.score);
        fused.set(r.id, e);
      });

      const ids = Array.from(fused.keys());
      if (ids.length === 0) return [];

      // Load product rows + their active locations.
      const products = await db
        .select()
        .from(product)
        .where(and(eq(product.storeId, storeId)));
      const productById = new Map(products.map((p) => [p.id, p]));

      const locRows = await db
        .select({
          productId: productLocation.productId,
          locationId: productLocation.id,
          shelfId: productLocation.shelfId,
          side: productLocation.side,
          seenCount: productLocation.seenCount,
          shelfCode: shelf.code,
        })
        .from(productLocation)
        .innerJoin(shelf, eq(productLocation.shelfId, shelf.id))
        .where(
          and(
            eq(productLocation.storeId, storeId),
            eq(productLocation.status, 'active'),
            eq(shelf.status, 'active')
          )
        );
      const locsByProduct = new Map<string, Candidate['locations']>();
      for (const l of locRows) {
        const arr = locsByProduct.get(l.productId) ?? [];
        arr.push({
          locationId: l.locationId,
          shelfId: l.shelfId,
          shelfCode: l.shelfCode,
          side: l.side ?? null,
          seenCount: l.seenCount,
        });
        locsByProduct.set(l.productId, arr);
      }

      const candidates: Candidate[] = [];
      for (const id of ids) {
        const p = productById.get(id);
        if (!p || p.status !== 'active') continue;
        const f = fused.get(id)!;
        // Trust boost: more evidence ⇒ higher rank (never hides anything).
        const boost = 1 + 0.1 * Math.log(1 + p.evidenceCount);
        candidates.push({
          productId: p.id,
          canonicalName: p.canonicalName,
          nameZh: p.nameZh,
          category: p.category,
          evidenceCount: p.evidenceCount,
          confidenceState: p.confidenceState,
          thumbnailKey: p.thumbnailKey,
          vectorScore: f.vectorScore,
          lexicalScore: f.lexicalScore,
          score: f.rrf * boost,
          locations: (locsByProduct.get(id) ?? []).sort(
            (a, b) => b.seenCount - a.seenCount
          ),
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates;
    },

    /**
     * Record a completed search. Test searches and content-safety deflections
     * are flagged so they can be excluded from owner statistics (§4.2, §10).
     */
    async logSearch(input: {
      queryText: string;
      queryLang: string;
      inputMethod: InputMethod;
      answerTone: AnswerTone | null;
      resultCount: number;
      isTest: boolean;
      isDeflected: boolean;
      latencyMs: number;
    }): Promise<void> {
      const db = await getDb();
      await db.insert(searchLog).values({
        id: nanoid(),
        storeId,
        queryText: input.queryText,
        queryLang: input.queryLang,
        inputMethod: input.inputMethod,
        answerTone: input.answerTone,
        resultCount: input.resultCount,
        isTest: input.isTest,
        isDeflected: input.isDeflected,
        latencyMs: input.latencyMs,
      });
    },

    /**
     * Record a miss (no result). Real shopper misses accumulate a count so the
     * owner insights can surface "products shoppers couldn't find" (§4.3).
     * Test/deflected searches never create misses.
     */
    async recordMiss(queryText: string): Promise<void> {
      const db = await getDb();
      const normalized = queryText.trim().toLowerCase().slice(0, 200);
      if (!normalized) return;
      await db
        .insert(missInsight)
        .values({
          id: nanoid(),
          storeId,
          queryText: normalized,
          hitlessCount: 1,
        })
        .onConflictDoUpdate({
          target: [missInsight.storeId, missInsight.queryText],
          set: {
            hitlessCount: sql`${missInsight.hitlessCount} + 1`,
            lastSearchedAt: new Date(),
            status: 'open',
          },
        });
    },
  };
}
