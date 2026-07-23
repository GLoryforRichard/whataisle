import { ASR_MODEL, GEN_MODEL } from '@/ai/models';
import { transcribeAudio } from '@/ai/transcribe';
import { recordUsage } from '@/ai/usage';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { getRequestStore } from '@/lib/store-context';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

/**
 * Transcribe a shopper voice clip to a search phrase (multipart: audio, lang?).
 *
 * The audio is processed in-memory and NEVER persisted (requirements §10:
 * shopper voice clips are the shopper's personal data). Only the transcribed
 * text is returned; the owner sees text only, never a replayable clip.
 */
export async function POST(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return NextResponse.json({ error: 'store_not_found' }, { status: 404 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const allowed = await checkRateLimit(`voice:${store.id}:${hashIp(ip)}`, {
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
  const audio = form.get('audio');
  const lang = (form.get('lang') as string) || undefined;
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const base64 = buffer.toString('base64');
    const started = Date.now();
    const result = await transcribeAudio(
      base64,
      audio.type || 'audio/webm',
      lang
    );
    const latencyMs = Date.now() - started;
    // Two models per voice search now: one ASR row (inputTokens = audio
    // seconds) and one cleanup-LLM row, so per-model cost math stays honest.
    await recordUsage({
      storeId: store.id,
      kind: 'transcribe',
      model: ASR_MODEL,
      usage: result.asrUsage,
      latencyMs,
    });
    await recordUsage({
      storeId: store.id,
      kind: 'transcribe',
      model: GEN_MODEL,
      usage: result.llmUsage,
      latencyMs,
    });
    return NextResponse.json({
      text: result.text,
      candidates: result.candidates,
    });
  } catch (err) {
    console.error('[transcribe] failed:', err);
    return NextResponse.json({ error: 'transcribe_failed' }, { status: 500 });
  }
}
