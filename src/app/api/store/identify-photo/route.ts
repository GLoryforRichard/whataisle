import { identifyProductFromPhoto } from '@/ai/identify-photo';
import { VISION_MODEL } from '@/ai/models';
import { recordUsage } from '@/ai/usage';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { getRequestStore } from '@/lib/store-context';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

/**
 * Identify a product from a shopper photo (multipart: image, lang?).
 *
 * The photo is processed in-memory and NEVER persisted (requirements §10) —
 * only the identified text phrase is returned for the shopper to confirm.
 */
export async function POST(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return NextResponse.json({ error: 'store_not_found' }, { status: 404 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const allowed = await checkRateLimit(`photo:${store.id}:${hashIp(ip)}`, {
    windowSeconds: 60,
    max: 20,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const image = form.get('image');
  const lang = (form.get('lang') as string) || undefined;
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await image.arrayBuffer());
    const started = Date.now();
    const result = await identifyProductFromPhoto(buffer, lang);
    await recordUsage({
      storeId: store.id,
      kind: 'identify',
      model: VISION_MODEL,
      usage: result.usage,
      latencyMs: Date.now() - started,
    });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    console.error('[identify-photo] failed:', err);
    return NextResponse.json({ error: 'identify_failed' }, { status: 500 });
  }
}
