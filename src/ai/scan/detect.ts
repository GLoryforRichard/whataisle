import 'server-only';

import pLimit from 'p-limit';
import sharp from 'sharp';
import {
  buildBands,
  mapBandBox,
  mergeBandBoxes,
  normalizeDetectedRows,
} from './bands';
import { extractJson, parseBoxes } from './box-parser';
import {
  BAND_CONCURRENCY,
  MAX_BAND_SIDE,
  ROW_DETECT_MODEL,
  SCAN_MODEL,
} from './config';
import { type CallOutcome, callModel } from './openrouter';
import {
  BAND_PROMPT,
  BOX_SCHEMA,
  ROW_DETECT_PROMPT,
  ROWS_SCHEMA,
} from './prompts';
import type { Band, NormalizedBox, ParseInfo, PreparedImage } from './types';

/**
 * Detection could not produce complete coverage (a band failed even after
 * retry). A coverage hole is worse than a visible failure, so callers should
 * surface this as a scan error. Carries the call outcomes so usage can still
 * be metered honestly.
 */
export class ScanFailedError extends Error {
  outcomes: CallOutcome[];

  constructor(message: string, outcomes: CallOutcome[]) {
    super(message);
    this.name = 'ScanFailedError';
    this.outcomes = outcomes;
  }
}

export interface RowBandsResult {
  bands: Band[];
  warning: string | null;
  /** The row-detect call outcome (null if the call itself threw). */
  outcome: CallOutcome | null;
}

/**
 * Detect shelf rows on the processed (≤2048px) image and turn them into
 * gap-free bands. Never fails the scan: any problem degrades to a single
 * full-image band with a warning.
 */
export async function detectRowBands(
  processed: PreparedImage
): Promise<RowBandsResult> {
  const fallbackBands = buildBands([]);
  const outcome = await callModel({
    modelId: ROW_DETECT_MODEL,
    imageJpeg: processed.jpeg,
    prompt: ROW_DETECT_PROMPT,
    schema: ROWS_SCHEMA,
    schemaName: 'shelf_rows',
    timeoutMs: 120_000,
  });
  if (!outcome.ok) {
    return {
      bands: fallbackBands,
      warning: `row detection failed, degraded to a single full-image band: ${outcome.error}`,
      outcome,
    };
  }
  const data = extractJson(outcome.rawText ?? '') as {
    rows?: { y0: number; y1: number }[];
  } | null;
  const rows = Array.isArray(data?.rows)
    ? data.rows.filter(
        (r) => typeof r?.y0 === 'number' && typeof r?.y1 === 'number'
      )
    : [];
  if (rows.length === 0) {
    return {
      bands: fallbackBands,
      warning:
        'row detection returned no usable rows, degraded to a single full-image band',
      outcome,
    };
  }
  const bands = buildBands(normalizeDetectedRows(rows));
  if (rows.length >= 2 && bands.length === 1) {
    // degenerate detector output (rows collapsed after normalization)
    return {
      bands: fallbackBands,
      warning: `row detection output was degenerate (${rows.length} rows collapsed to 1 band), degraded to a single full-image band`,
      outcome,
    };
  }
  return { bands, warning: null, outcome };
}

export interface DetectOptions {
  /** 'low' = the try-out fast path; omit for full reasoning (staff scans). */
  reasoningEffort?: 'low';
  modelId?: string;
}

export interface DetectResult {
  boxes: NormalizedBox[];
  parse: ParseInfo;
  /** Every band call attempt, for usage metering. */
  outcomes: CallOutcome[];
  latencyMs: number;
  callCount: number;
}

/**
 * rows-hd band detection (the benchmark champion): slice each band from the
 * full-resolution image, cap the long side at MAX_BAND_SIDE, detect per band
 * concurrently, then map band-local boxes back and dedup across bands.
 *
 * A band must yield a parseable box list — an unparseable success is as bad
 * as a failed call (silent coverage hole for that whole strip). Retry once
 * covering both failure kinds; a band that still fails throws ScanFailedError.
 */
export async function detectBoxes(
  full: PreparedImage,
  bands: Band[],
  opts: DetectOptions = {}
): Promise<DetectResult> {
  const modelId = opts.modelId ?? SCAN_MODEL;
  const bandLimit = pLimit(BAND_CONCURRENCY);
  const started = performance.now();

  const slices = await Promise.all(
    bands.map(async (b) => {
      const top = Math.round(b.y0 * full.height);
      const height = Math.max(1, Math.round((b.y1 - b.y0) * full.height));
      const buf = await sharp(full.jpeg)
        .extract({
          left: 0,
          top: Math.min(top, full.height - 1),
          width: full.width,
          height: Math.min(height, full.height - top),
        })
        .resize(MAX_BAND_SIDE, MAX_BAND_SIDE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      const meta = await sharp(buf).metadata();
      return {
        buf,
        width: meta.width ?? full.width,
        height: meta.height ?? height,
      };
    })
  );

  const runBand = async (slice: (typeof slices)[number]) => {
    const call = () =>
      callModel({
        modelId,
        imageJpeg: slice.buf,
        prompt: BAND_PROMPT,
        schema: BOX_SCHEMA,
        schemaName: 'shelf_product_boxes',
        reasoningEffort: opts.reasoningEffort,
      });
    const attempts: CallOutcome[] = [];
    let parsed: ReturnType<typeof parseBoxes> | null = null;
    for (let n = 0; n < 2 && !parsed; n++) {
      if (n > 0) await new Promise((r) => setTimeout(r, 2000));
      const o = await call();
      attempts.push(o);
      if (!o.ok) continue;
      const p = parseBoxes(o.rawText ?? '', slice.width, slice.height);
      if (p.ok) parsed = p;
    }
    return { attempts, parsed };
  };
  const bandResults = await Promise.all(
    slices.map((s) => bandLimit(() => runBand(s)))
  );
  const latencyMs = Math.round(performance.now() - started);
  const allAttempts = bandResults.flatMap((r) => r.attempts);

  const failed = bandResults
    .map((r, i) => {
      if (r.parsed) return null;
      const last = r.attempts.at(-1);
      return `band${i}: ${last?.ok ? 'unparseable output' : last?.error}`;
    })
    .filter((x): x is string => x !== null);
  if (failed.length > 0) {
    throw new ScanFailedError(
      `some bands failed after retry (coverage incomplete): ${failed.join('; ')}`,
      allAttempts
    );
  }

  const warnings: string[] = [];
  const perBand: NormalizedBox[][] = [];
  let coordOrderUsed: ParseInfo['coordOrderUsed'] = null;
  let scaleDetected: ParseInfo['scaleDetected'] = null;
  bandResults.forEach((r, i) => {
    const parsed = r.parsed;
    if (!parsed) return;
    coordOrderUsed ??= parsed.coordOrderUsed;
    scaleDetected ??= parsed.scaleDetected;
    warnings.push(...parsed.warnings.map((w) => `band${i}: ${w}`));
    perBand.push(parsed.boxes.map((b) => mapBandBox(b, bands[i])));
    if (r.attempts.length > 1) {
      warnings.push(
        `band${i}: first attempt failed, retry succeeded (${r.attempts[0].error ?? 'parse failure'})`
      );
    }
  });

  // Champion rows-hd behavior: cross-band dedup only, NO same-label merging
  // (measured better without it — readout renames boxes individually).
  const { boxes, dropped } = mergeBandBoxes(perBand, bands);
  if (dropped > 0) {
    warnings.push(`merged: dropped ${dropped} overlap/duplicate boxes`);
  }

  return {
    boxes,
    parse: { ok: true, coordOrderUsed, scaleDetected, warnings },
    outcomes: allAttempts,
    latencyMs,
    callCount: allAttempts.length,
  };
}
