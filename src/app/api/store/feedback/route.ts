import { feedbackRepo } from '@/data/feedback-repo';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { getRequestStore } from '@/lib/store-context';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({
  productId: z.string().min(1),
});

/**
 * Shopper "I looked — it's not there" feedback (no login, one tap).
 *
 * Deduped per reporter/day so one person can't spam a product into doubt.
 * Never modifies store data directly — only lowers confidence tone after
 * enough independent reports and files a staff review task (§8).
 */
export async function POST(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return NextResponse.json({ error: 'store_not_found' }, { status: 404 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ua = req.headers.get('user-agent') ?? '';

  const allowed = await checkRateLimit(`feedback:${store.id}:${hashIp(ip)}`, {
    windowSeconds: 60,
    max: 15,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Reporter identity = hash(ip + ua + day) — dedupes without storing PII.
  const day = new Date().toISOString().slice(0, 10);
  const reporterHash = hashIp(`${ip}|${ua}|${day}`, 'feedback');

  const result = await feedbackRepo(store.id).reportNotThere({
    productId: parsed.data.productId,
    reporterHash,
  });

  // Always return ok so the shopper gets a friendly acknowledgement; the
  // effect (if any) happens server-side.
  return NextResponse.json({ ok: true, recorded: result.recorded });
}
