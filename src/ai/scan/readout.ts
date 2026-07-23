import 'server-only';

import pLimit from 'p-limit';
import sharp from 'sharp';
import { GRID_CONCURRENCY, GRID_K, READOUT_MODEL } from './config';
import { extractJson } from './box-parser';
import {
  type CropRect,
  GRID_CELL_SIZE,
  cropRect,
  gridLayout,
  parseGridNames,
} from './grid';
import { type CallOutcome, callModel } from './openrouter';
import {
  READ_NAME_PROMPT,
  READ_NAME_SCHEMA,
  buildGridReadPrompt,
  buildGridReadSchema,
} from './prompts';
import type { NormalizedBox, PreparedImage } from './types';

/**
 * Grid readout (stage 2): re-read each detected box's product name from its
 * full-resolution crop, GRID_K crops stitched per call (≈10× fewer calls than
 * per-crop), with per-crop fallback for any grid chunk that fails twice.
 * Runs with minimal reasoning — naming a single crop needs no thinking
 * (measured near-lossless and much cheaper than full reasoning).
 */

/** Stitch crops into one white-background numbered grid image. */
async function buildGridImage(
  fullJpeg: Buffer,
  rects: CropRect[]
): Promise<Buffer> {
  const layout = gridLayout(rects.length);
  const CELL = GRID_CELL_SIZE;
  const resized = await Promise.all(
    rects.map((r) =>
      sharp(fullJpeg)
        .extract(r)
        .resize(CELL, CELL, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 88 })
        .toBuffer()
        .then(async (buf) => ({ buf, meta: await sharp(buf).metadata() }))
    )
  );
  const numberSvgParts = layout.cells.map(
    (c, i) =>
      `<text x="${c.labelX}" y="${c.labelY}" font-family="sans-serif" font-size="34" font-weight="bold" fill="#1d4ed8" stroke="#ffffff" stroke-width="6" paint-order="stroke">${i + 1}</text>` +
      `<rect x="${c.x - 2}" y="${c.y - 2}" width="${c.w + 4}" height="${c.h + 4}" fill="none" stroke="#d1d5db" stroke-width="2"/>`
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">${numberSvgParts.join('')}</svg>`;
  return sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      ...resized.map(({ buf, meta }, i) => ({
        input: buf,
        // center the crop inside its cell
        left:
          layout.cells[i].x +
          Math.max(0, Math.round((CELL - (meta.width ?? CELL)) / 2)),
        top:
          layout.cells[i].y +
          Math.max(0, Math.round((CELL - (meta.height ?? CELL)) / 2)),
      })),
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function readOneBox(
  modelId: string,
  fullJpeg: Buffer,
  rect: CropRect,
  collect: CallOutcome[]
): Promise<string | null> {
  const crop = await sharp(fullJpeg)
    .extract(rect)
    .jpeg({ quality: 88 })
    .toBuffer();
  const attempt = async (): Promise<string | null> => {
    const outcome = await callModel({
      modelId,
      imageJpeg: crop,
      prompt: READ_NAME_PROMPT,
      schema: READ_NAME_SCHEMA,
      schemaName: 'product_name',
      timeoutMs: 60_000,
      reasoningEffort: 'off',
    });
    collect.push(outcome);
    if (!outcome.ok) return null;
    const data = extractJson(outcome.rawText ?? '') as {
      name?: unknown;
    } | null;
    return typeof data?.name === 'string' && data.name.trim()
      ? data.name.trim()
      : null;
  };
  const first = await attempt();
  if (first !== null) return first;
  await new Promise((r) => setTimeout(r, 1000));
  return attempt();
}

/** One grid chunk: stitch → single call → K names. null = chunk failed. */
async function readGridChunk(
  modelId: string,
  fullJpeg: Buffer,
  rects: CropRect[],
  collect: CallOutcome[]
): Promise<(string | null)[] | null> {
  const grid = await buildGridImage(fullJpeg, rects);
  const outcome = await callModel({
    modelId,
    imageJpeg: grid,
    prompt: buildGridReadPrompt(rects.length),
    schema: buildGridReadSchema(rects.length),
    schemaName: 'grid_product_names',
    timeoutMs: 120_000,
    reasoningEffort: 'off',
  });
  collect.push(outcome);
  if (!outcome.ok) return null;
  return parseGridNames(outcome.rawText ?? '', rects.length);
}

export interface ReadoutResult {
  /** names[i] overrides boxes[i].label; null = read failed, keep the label. */
  names: (string | null)[];
  outcomes: CallOutcome[];
  fallbackChunks: number;
  failedCount: number;
  latencyMs: number;
}

export async function readProductNames(
  full: PreparedImage,
  boxes: NormalizedBox[]
): Promise<ReadoutResult> {
  if (boxes.length === 0) {
    return {
      names: [],
      outcomes: [],
      fallbackChunks: 0,
      failedCount: 0,
      latencyMs: 0,
    };
  }
  const started = performance.now();
  const modelId = READOUT_MODEL;
  const rects = boxes.map((b) => cropRect(b, full.width, full.height));
  const outcomes: CallOutcome[] = [];

  const chunks: { start: number; rects: CropRect[] }[] = [];
  for (let i = 0; i < rects.length; i += GRID_K) {
    chunks.push({ start: i, rects: rects.slice(i, i + GRID_K) });
  }
  const limit = pLimit(GRID_CONCURRENCY);
  const names: (string | null)[] = new Array(rects.length).fill(null);
  let fallbackChunks = 0;

  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        let res = await readGridChunk(
          modelId,
          full.jpeg,
          chunk.rects,
          outcomes
        );
        if (!res) {
          res = await readGridChunk(modelId, full.jpeg, chunk.rects, outcomes);
        }
        if (res) {
          res.forEach((n, j) => {
            names[chunk.start + j] = n;
          });
          return;
        }
        // grid failed twice → per-crop fallback for this chunk (accuracy first)
        fallbackChunks++;
        const singles = await Promise.all(
          chunk.rects.map((r) => readOneBox(modelId, full.jpeg, r, outcomes))
        );
        singles.forEach((n, j) => {
          names[chunk.start + j] = n;
        });
      })
    )
  );

  return {
    names,
    outcomes,
    fallbackChunks,
    failedCount: names.filter((n) => n === null).length,
    latencyMs: Math.round(performance.now() - started),
  };
}
