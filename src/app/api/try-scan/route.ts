import { PRECHECK_MODEL, SCAN_MODEL, isScanConfigured } from '@/ai/scan/config';
import { extractJson } from '@/ai/scan/box-parser';
import { ScanFailedError, detectBoxes, detectRowBands } from '@/ai/scan/detect';
import { prepareScanImages } from '@/ai/scan/image';
import { extractEntries } from '@/ai/scan/names';
import { type CallOutcome, callModel, sumTokens } from '@/ai/scan/openrouter';
import { PRECHECK_PROMPT, PRECHECK_SCHEMA } from '@/ai/scan/prompts';
import type { NormalizedBox } from '@/ai/scan/types';
import { stubScanBoxes } from '@/ai/stub';
import { recordUsage } from '@/ai/usage';
import { getClientIp } from '@/lib/client-ip';
import {
  checkRateLimit,
  hashIp,
  peekRateLimit,
  refundRateLimit,
} from '@/lib/rate-limit';
import { type NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Fixed-window key that in practice never rolls over → a lifetime cap. */
const LIFETIME_WINDOW_SECONDS = 10 * 365 * 24 * 60 * 60;
const LIFETIME_MAX = 3;
/** Pre-check probing cap per IP per day (failures don't touch the 3). */
const PROBE_WINDOW_SECONDS = 86_400;
const PROBE_MAX = 12;

function jsonError(error: string, status: number, extra?: object) {
  return NextResponse.json({ error, ...extra }, { status });
}

async function meterTryDetect(
  outcomes: CallOutcome[],
  latencyMs: number,
  refId: string
) {
  if (outcomes.length === 0) return;
  const t = sumTokens(outcomes);
  await recordUsage({
    storeId: null,
    kind: 'try_detect',
    model: SCAN_MODEL,
    usage: {
      inputTokens: t.prompt,
      outputTokens: t.completion,
      images: outcomes.length,
    },
    latencyMs,
    refId,
  });
}

/**
 * Landing-page try-out: one shelf photo in, detected product boxes out.
 * Public and unauthenticated, so defense-in-depth:
 *  - per-IP LIFETIME cap of 3 successful scans (checked race-safely below);
 *  - per-IP daily probe cap on the cheap pre-check;
 *  - a small-model gate that rejects non-shelf / illegible photos BEFORE the
 *    expensive detection run (failed gates don't consume the lifetime cap).
 * Nothing is persisted: the image is processed entirely in memory and the
 * response carries a server-rendered preview (HEIC-safe, EXIF-aligned).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const ipHash = hashIp(ip, 'try');
  const lifeKey = `try:life:${ipHash}`;

  // UX fast-path — the race-safe enforcement is the consume step below.
  if ((await peekRateLimit(lifeKey)) >= LIFETIME_MAX) {
    return jsonError('limit_reached', 403);
  }
  const probeAllowed = await checkRateLimit(`try:pre:${ipHash}`, {
    windowSeconds: PROBE_WINDOW_SECONDS,
    max: PROBE_MAX,
  });
  if (!probeAllowed) {
    return jsonError('rate_limited', 429);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('invalid_request', 400);
  }
  const file = form.get('image');
  if (!(file instanceof Blob)) {
    return jsonError('invalid_request', 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError('too_large', 413);
  }

  let images: Awaited<ReturnType<typeof prepareScanImages>>;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    images = await prepareScanImages(buffer);
  } catch {
    return jsonError('invalid_image', 400);
  }

  const stubMode = !isScanConfigured();

  // Pre-check gate on a small downscale (skipped in stub mode).
  if (!stubMode) {
    const precheckJpeg = await sharp(images.processed.jpeg)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const gate = await callModel({
      modelId: PRECHECK_MODEL,
      imageJpeg: precheckJpeg,
      prompt: PRECHECK_PROMPT,
      schema: PRECHECK_SCHEMA,
      schemaName: 'try_precheck',
      timeoutMs: 20_000,
      reasoningEffort: 'off',
    });
    const t = gate.tokens;
    await recordUsage({
      storeId: null,
      kind: 'try_precheck',
      model: PRECHECK_MODEL,
      usage: {
        inputTokens: t?.prompt ?? 0,
        outputTokens: t?.completion ?? 0,
        images: 1,
      },
      latencyMs: gate.latencyMs,
      refId: ipHash,
    });
    if (gate.ok) {
      const verdict = extractJson(gate.rawText ?? '') as {
        is_shelf?: unknown;
        labels_legible?: unknown;
      } | null;
      if (verdict?.is_shelf === false) return jsonError('not_shelf', 422);
      if (verdict?.labels_legible === false) {
        return jsonError('not_legible', 422);
      }
    }
    // Gate call failed or was unparseable → let the scan proceed rather than
    // block a curious visitor on gate flakiness (the lifetime cap still holds).
  }

  // Consume one lifetime unit — atomic upsert, so concurrent requests can't
  // sneak past the cap even when the peek above raced.
  const allowed = await checkRateLimit(lifeKey, {
    windowSeconds: LIFETIME_WINDOW_SECONDS,
    max: LIFETIME_MAX,
  });
  if (!allowed) {
    return jsonError('limit_reached', 403);
  }

  let boxes: NormalizedBox[];
  if (stubMode) {
    boxes = stubScanBoxes(`${ipHash}:${file.size}`);
  } else {
    // rows-hd-fast: HD band detection with low reasoning, no readout stage —
    // the latency/cost point picked for the free try-out.
    const started = Date.now();
    try {
      const rows = await detectRowBands(images.processed);
      const det = await detectBoxes(images.full, rows.bands, {
        reasoningEffort: 'low',
      });
      const outcomes = rows.outcome
        ? [rows.outcome, ...det.outcomes]
        : det.outcomes;
      await meterTryDetect(outcomes, Date.now() - started, ipHash);
      boxes = det.boxes;
    } catch (err) {
      if (err instanceof ScanFailedError) {
        await meterTryDetect(err.outcomes, Date.now() - started, ipHash);
      } else {
        console.error('[try-scan] detection failed:', err);
      }
      // The visitor got nothing — give the lifetime unit back.
      await refundRateLimit(lifeKey);
      return jsonError('scan_failed', 500);
    }
  }

  // Server-rendered preview: HEIC uploads can't be shown by the browser, and
  // box fractions are relative to the EXIF-rotated image — this preview is
  // guaranteed aligned with the boxes.
  const previewJpeg = await sharp(images.processed.jpeg)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const previewMeta = await sharp(previewJpeg).metadata();

  const entries = extractEntries(boxes);
  const used = await peekRateLimit(lifeKey);
  return NextResponse.json({
    boxes,
    count: entries.length,
    names: entries.map((e) => e.name),
    preview: {
      dataUrl: `data:image/jpeg;base64,${previewJpeg.toString('base64')}`,
      width: previewMeta.width ?? images.processed.width,
      height: previewMeta.height ?? images.processed.height,
    },
    remaining: Math.max(0, LIFETIME_MAX - used),
  });
}
