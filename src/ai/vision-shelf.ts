import 'server-only';

import { ThinkingLevel } from '@google/genai';
import sharp from 'sharp';
import {
  generateContentWithHedge,
  generateContentWithRetry,
  isAiConfigured,
} from './client';
import { GEN_MODEL } from './models';
import { stubDetectProducts } from './stub';
import { EMPTY_USAGE, type UsageTotals, addUsage, extractUsage } from './usage';

/**
 * Two-stage shelf vision (ported from wherebear lib/gemini.ts):
 *   Stage 1: full shelf → bounding boxes only (one box per unique SKU)
 *   Crop:    sharp cuts each box from the full-res image (thumbnails too)
 *   Stage 2: all crops in ONE call → specific name + category per crop
 *   Dedupe:  collapse multi-row SKUs, keep the best crop as the thumbnail
 *
 * Faces are located in Stage 1 and blurred before any photo is persisted
 * (requirements §10) — see blurFaces() in face-blur.ts, fed by `faces` here.
 */

export interface DetectedProduct {
  name: string;
  nameZh?: string;
  category?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** 240px JPEG data URL cropped from the shelf photo, used as the thumbnail. */
  thumbnailDataUrl?: string;
}

export interface FaceBox {
  /** [y_min, x_min, y_max, x_max] normalized 0–1000. */
  box_2d: [number, number, number, number];
}

export interface ShelfVisionResult {
  products: DetectedProduct[];
  faces: FaceBox[];
  usage: UsageTotals;
}

const STAGE1_PROMPT = `You are looking at a grocery store shelf photo from an Asian / international supermarket.

Locate every DISTINCT retail product SKU physically placed on the shelf. Do NOT name the products yet — Stage 2 identifies each from a close-up crop.

ONE BOX PER UNIQUE SKU, NOT PER PACKAGE. Grocery shelves stock several identical copies of every SKU; return ONE box per unique SKU covering the whole cluster of identical packages. Different flavor/size variants are DIFFERENT SKUs → separate boxes. A typical full shelf yields 8–20 SKU boxes, not 50+.

Skip cardboard shipping boxes at the top (storage), price tags, and anything not for sale.

ALSO return any human faces visible in the photo (shoppers/staff), so they can be blurred for privacy.

Return ONLY a JSON object (no prose, no code fence):
{
  "boxes": [ {"box_2d":[y_min,x_min,y_max,x_max]}, ... ],
  "faces": [ {"box_2d":[y_min,x_min,y_max,x_max]}, ... ]
}
All coordinates normalized to 0–1000. If the shelf is empty, return {"boxes":[],"faces":[]}.`;

const STAGE2_PROMPT = `You will receive several cropped photos of SINGLE grocery products from an Asian / international supermarket, in order.

For EACH crop in order, identify the SPECIFIC product by reading every visible word on the packaging in any language (English, 中文, 한국어, 日本語, etc.).

Name the SPECIFIC product, never a category fallback (forbidden: "Sauce", "Noodle", "Snack", "Drink", "Tea", "Oil", "Beans", "Chips"). Combine brand + variety when visible: "Samyang Buldak Ramen", "Kewpie Mayonnaise", "Lao Gan Ma Chili Crisp". If unreadable, set confidence="low" and give a short visual descriptor.

Return ONLY a JSON array with EXACTLY one object per crop, in the SAME ORDER:
[ {"name":"...","category":"sauce|noodle|snack|frozen|drink|dry-good|fresh|other","confidence":"high|medium|low"} ]`;

interface Box {
  box_2d: [number, number, number, number];
}

interface Identified {
  name: string;
  category?: string;
  confidence?: 'high' | 'medium' | 'low';
}

const STAGE2_MAX_CROPS = 40;
const MAX_BOXES = 56;

function parseBoxes(raw: unknown): Box[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b): Box | null => {
      const box = (b as Box)?.box_2d;
      if (!Array.isArray(box) || box.length !== 4) return null;
      const [y0, x0, y1, x1] = box;
      if (
        ![y0, x0, y1, x1].every(
          (n) => typeof n === 'number' && Number.isFinite(n)
        )
      )
        return null;
      if (y1 <= y0 || x1 <= x0) return null;
      return { box_2d: [y0, x0, y1, x1] };
    })
    .filter((b): b is Box => !!b);
}

async function cropBox(
  raw: { data: Buffer; width: number; height: number; channels: 3 | 4 },
  imgW: number,
  imgH: number,
  box: [number, number, number, number]
): Promise<{
  visionBase64: string;
  thumbDataUrl: string;
  pixelArea: number;
} | null> {
  const [y0, x0, y1, x1] = box;
  const PAD = 0.04;
  const ny0 = Math.min(1, Math.max(0, y0 / 1000 - PAD));
  const nx0 = Math.min(1, Math.max(0, x0 / 1000 - PAD));
  const ny1 = Math.min(1, Math.max(0, y1 / 1000 + PAD));
  const nx1 = Math.min(1, Math.max(0, x1 / 1000 + PAD));
  const left = Math.min(imgW - 1, Math.max(0, Math.round(nx0 * imgW)));
  const top = Math.min(imgH - 1, Math.max(0, Math.round(ny0 * imgH)));
  const width = Math.max(
    1,
    Math.min(imgW - left, Math.round((nx1 - nx0) * imgW))
  );
  const height = Math.max(
    1,
    Math.min(imgH - top, Math.round((ny1 - ny0) * imgH))
  );
  if (width < 8 || height < 8) return null;

  try {
    const fromRaw = () =>
      sharp(raw.data, {
        raw: { width: raw.width, height: raw.height, channels: raw.channels },
      }).extract({ left, top, width, height });
    const [visionJpeg, thumbJpeg] = await Promise.all([
      fromRaw()
        .resize({
          width: 384,
          height: 384,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 76 })
        .toBuffer(),
      fromRaw()
        .resize({
          width: 240,
          height: 240,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 72 })
        .toBuffer(),
    ]);
    return {
      visionBase64: visionJpeg.toString('base64'),
      thumbDataUrl: `data:image/jpeg;base64,${thumbJpeg.toString('base64')}`,
      pixelArea: width * height,
    };
  } catch {
    return null;
  }
}

async function stage1(
  imageBase64: string,
  shelfContext?: string
): Promise<{ boxes: Box[]; faces: FaceBox[]; usage: Partial<UsageTotals> }> {
  const prompt = shelfContext
    ? `${STAGE1_PROMPT}\n\nShelf hint: ${shelfContext}`
    : STAGE1_PROMPT;
  const result = await generateContentWithHedge(
    {
      model: GEN_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    },
    15000
  );
  const usage = extractUsage(result, 1);
  try {
    const parsed = JSON.parse(result.text ?? '{}');
    return {
      boxes: parseBoxes(parsed.boxes).slice(0, MAX_BOXES),
      faces: parseBoxes(parsed.faces),
      usage,
    };
  } catch {
    return { boxes: [], faces: [], usage };
  }
}

async function stage2(
  crops: string[],
  shelfContext?: string
): Promise<{ identified: Identified[]; usage: Partial<UsageTotals> }> {
  if (crops.length === 0) return { identified: [], usage: {} };
  const prompt = shelfContext
    ? `${STAGE2_PROMPT}\n\nShelf hint: ${shelfContext}`
    : STAGE2_PROMPT;
  const parts: Array<{
    text?: string;
    inlineData?: { data: string; mimeType: string };
  }> = [{ text: prompt }];
  crops.forEach((data, i) => {
    parts.push({ text: `Crop ${i + 1}:` });
    parts.push({ inlineData: { data, mimeType: 'image/jpeg' } });
  });
  const result = await generateContentWithHedge(
    {
      model: GEN_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    },
    15000
  );
  const usage = extractUsage(result, crops.length);
  try {
    const parsed = JSON.parse(result.text ?? '[]');
    return { identified: Array.isArray(parsed) ? parsed : [], usage };
  } catch {
    return { identified: [], usage };
  }
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect and identify products in a shelf photo. Falls back to deterministic
 * stub recognition when AI is not configured, so the whole pipeline stays
 * testable offline.
 */
export async function detectShelfProducts(
  imageBuffer: Buffer,
  opts: { shelfContext?: string; stubSeed?: string } = {}
): Promise<ShelfVisionResult> {
  if (!isAiConfigured()) {
    const stubbed = stubDetectProducts(opts.stubSeed ?? 'shelf');
    return {
      products: stubbed.map((p) => ({
        name: p.name,
        nameZh: p.nameZh,
        category: p.category,
        confidence: p.confidence,
      })),
      faces: [],
      usage: { ...EMPTY_USAGE },
    };
  }

  let usage: UsageTotals = { ...EMPTY_USAGE };

  // Bake EXIF orientation into pixels so sharp.extract and Gemini agree.
  let buffer: Buffer;
  try {
    buffer = await sharp(imageBuffer).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch (err) {
    throw new Error(
      `image decode failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const stage1Buffer = await sharp(buffer)
    .resize({
      width: 1280,
      height: 1280,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();

  const s1 = await stage1(stage1Buffer.toString('base64'), opts.shelfContext);
  usage = addUsage(usage, s1.usage);
  if (s1.boxes.length === 0) {
    return { products: [], faces: s1.faces, usage };
  }

  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (!imgW || !imgH) return { products: [], faces: s1.faces, usage };

  const { data: rawData, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rawImage = {
    data: rawData,
    width: info.width,
    height: info.height,
    channels: info.channels as 3 | 4,
  };

  const crops = await Promise.all(
    s1.boxes.map((b) => cropBox(rawImage, imgW, imgH, b.box_2d))
  );
  const kept = crops
    .map((c, i) => (c ? { crop: c, box: s1.boxes[i] } : null))
    .filter(
      (c): c is { crop: NonNullable<(typeof crops)[number]>; box: Box } => !!c
    );
  if (kept.length === 0) return { products: [], faces: s1.faces, usage };

  const s2 = await stage2(
    kept.slice(0, STAGE2_MAX_CROPS).map((k) => k.crop.visionBase64),
    opts.shelfContext
  );
  usage = addUsage(usage, s2.usage);

  // Merge by index, then dedupe multi-row SKUs keeping the best crop.
  interface Candidate {
    product: DetectedProduct;
    confidence: string;
    pixelArea: number;
  }
  const candidates: Candidate[] = kept.map((k, i) => {
    const id = s2.identified[i];
    return {
      product: {
        name: id?.name?.trim() || 'Unidentified product',
        category: id?.category || 'other',
        confidence: id?.confidence || 'low',
        thumbnailDataUrl: k.crop.thumbDataUrl,
      },
      confidence: id?.confidence || 'low',
      pixelArea: k.crop.pixelArea,
    };
  });

  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = normalizeName(c.product.name);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  const products = Array.from(groups.values()).map((arr) => {
    arr.sort((a, b) => {
      const ca = CONFIDENCE_RANK[a.confidence] ?? 0;
      const cb = CONFIDENCE_RANK[b.confidence] ?? 0;
      if (cb !== ca) return cb - ca;
      return b.pixelArea - a.pixelArea;
    });
    return arr[0].product;
  });

  return { products, faces: s1.faces, usage };
}
