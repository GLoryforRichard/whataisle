import 'server-only';

import sharp, { type OverlayOptions } from 'sharp';
import type { FaceBox } from './vision-shelf';

/**
 * Blur any detected faces into a shelf photo before it is persisted
 * (requirements §10: faces in staff shelf photos are automatically blurred).
 *
 * Pragmatic approach: faces are located in the Stage-1 vision call (no extra
 * request), and here we composite a heavy blur over each region. Recall is
 * imperfect — staff can always delete a photo — but the common case (a shopper
 * in frame) is covered, and the original unblurred bytes are never stored.
 *
 * Returns a re-encoded JPEG with faces blurred, plus how many were blurred.
 */
export async function blurFaces(
  imageBuffer: Buffer,
  faces: FaceBox[]
): Promise<{ buffer: Buffer; blurredCount: number }> {
  // Normalize orientation so face coords (from the upright image Gemini saw)
  // line up with the pixels we edit.
  const base = sharp(imageBuffer).rotate();
  const meta = await base.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  const normalized = await base.jpeg({ quality: 90 }).toBuffer();

  if (!faces.length || !imgW || !imgH) {
    return { buffer: normalized, blurredCount: 0 };
  }

  const overlays: OverlayOptions[] = [];
  for (const face of faces) {
    const [y0, x0, y1, x1] = face.box_2d;
    // Pad the box generously — better to blur a little extra than miss an edge.
    const PAD = 0.03;
    const left = Math.max(
      0,
      Math.round((Math.min(x0, x1) / 1000 - PAD) * imgW)
    );
    const top = Math.max(0, Math.round((Math.min(y0, y1) / 1000 - PAD) * imgH));
    const width = Math.min(
      imgW - left,
      Math.max(1, Math.round((Math.abs(x1 - x0) / 1000 + 2 * PAD) * imgW))
    );
    const height = Math.min(
      imgH - top,
      Math.max(1, Math.round((Math.abs(y1 - y0) / 1000 + 2 * PAD) * imgH))
    );
    if (width < 4 || height < 4) continue;

    try {
      const region = await sharp(normalized)
        .extract({ left, top, width, height })
        .blur(Math.max(8, Math.round(Math.min(width, height) / 4)))
        .toBuffer();
      overlays.push({ input: region, left, top });
    } catch {
      // Skip a region that couldn't be extracted rather than failing the save.
    }
  }

  if (overlays.length === 0) {
    return { buffer: normalized, blurredCount: 0 };
  }

  const out = await sharp(normalized)
    .composite(overlays)
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer: out, blurredCount: overlays.length };
}
