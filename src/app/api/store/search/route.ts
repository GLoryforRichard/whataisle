import { checkQuery } from '@/ai/guardrails';
import { type SearchResult, runSearch } from '@/ai/search-pipeline';
import { searchRepo } from '@/data/search-repo';
import { getStaffSession } from '@/lib/staff-auth';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { getRequestStore } from '@/lib/store-context';
import { getStorageUrlForKey } from '@/lib/store-files';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Shopper search — Server-Sent Events. Streams the "thinking" steps as they
 * happen, then a final result. Tenant is resolved from the request host; the
 * query is content-safety filtered before any AI runs; rate limited per IP.
 *
 * Query params: q (required), test=1 (staff test search, excluded from stats).
 */
export async function GET(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return new NextResponse('store not found', { status: 404 });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const inputMethod =
    (url.searchParams.get('input') as 'text' | 'voice' | 'photo') ?? 'text';

  // Staff test searches are excluded from statistics.
  const staff = await getStaffSession(store);
  const isTest = url.searchParams.get('test') === '1' && !!staff;

  // Rate limit the public endpoint (skip for authenticated staff test search).
  if (!isTest) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const allowed = await checkRateLimit(`search:${store.id}:${hashIp(ip)}`, {
      windowSeconds: 60,
      max: 30,
    });
    if (!allowed) {
      return new NextResponse('rate limited', { status: 429 });
    }
  }

  const repo = searchRepo(store.id);
  const started = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const guard = checkQuery(query);
        if (!guard.ok) {
          // Off-topic / injection / enumeration: polite deflection, logged as
          // deflected (excluded from stats), never acted on.
          if (guard.reason !== 'empty') {
            await repo.logSearch({
              queryText: query.slice(0, 200),
              queryLang: /[㐀-鿿]/.test(query) ? 'zh' : 'en',
              inputMethod,
              answerTone: null,
              resultCount: 0,
              isTest,
              isDeflected: true,
              latencyMs: Date.now() - started,
            });
          }
          send('deflected', {
            answerEn: 'I can only help you find products in this store.',
            answerZh: '我只能帮您在这家店里找商品。',
          });
          controller.close();
          return;
        }

        const result = await runSearch({ storeId: store.id, query }, (step) =>
          send('step', step)
        );

        // Attach public thumbnail URLs for candidates.
        const withThumbs = (list: SearchResult['candidates']) =>
          list.map((c) => ({
            ...c,
            thumbnailUrl: c.thumbnailKey
              ? getStorageUrlForKey(c.thumbnailKey)
              : null,
          }));

        send('result', {
          tone: result.tone,
          answerEn: result.answerEn,
          answerZh: result.answerZh,
          candidates: withThumbs(result.candidates),
          guesses: withThumbs(result.guesses),
          detectedLang: result.detectedLang,
          degraded: result.degraded,
          stepCount: result.steps.length,
        });

        await repo.logSearch({
          queryText: query.slice(0, 200),
          queryLang: result.detectedLang,
          inputMethod,
          answerTone: result.tone,
          resultCount: result.candidates.length,
          isTest,
          isDeflected: false,
          latencyMs: Date.now() - started,
        });

        // A real shopper miss feeds owner insights (§4.3).
        if (!isTest && result.tone === 'none') {
          await repo.recordMiss(query);
        }
      } catch (err) {
        console.error('[search] failed:', err);
        send('error', { message: 'search_failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
