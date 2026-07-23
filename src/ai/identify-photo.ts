import 'server-only';

import sharp from 'sharp';
import { chatWithHedge, isAiConfigured } from './client';
import { VISION_MODEL } from './models';
import { type UsageTotals, extractUsage } from './usage';

/**
 * "Find by photo": identify the single product a shopper photographed and
 * return a clean search phrase (ported from wherebear identifyProductFromPhoto).
 */

const PROMPT = `The shopper photographed a product they want to FIND in a grocery store.

Identify the SPECIFIC product so we can search the store:
- Read packaging text in any language; output brand + variety when visible (e.g. "Lao Gan Ma Chili Crisp", "Samyang Buldak Ramen").
- If text is unreadable, name the specific item type from appearance (e.g. "Sushi Nori", "Mung Beans").
- Pick the single most prominent/centered product if several are visible.
- Output ONLY the product name as a short search phrase. No quotes, no explanation.
- If there's no identifiable grocery product, output exactly: (unclear)`;

export interface IdentifyResult {
  text: string;
  usage: Partial<UsageTotals>;
}

export async function identifyProductFromPhoto(
  imageBuffer: Buffer,
  langHint?: string
): Promise<IdentifyResult> {
  if (!isAiConfigured()) {
    return { text: '', usage: {} };
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(imageBuffer)
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (err) {
    throw new Error(
      `image decode failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const hint =
    langHint === 'zh'
      ? '\n\nIf the product name is Chinese, answer in Chinese.'
      : '';

  const result = await chatWithHedge(
    {
      model: VISION_MODEL,
      parts: [
        { text: PROMPT + hint },
        { image: { base64: jpeg.toString('base64'), mimeType: 'image/jpeg' } },
      ],
      temperature: 0.2,
      thinking: false,
    },
    5000
  );
  const usage = extractUsage(result, 1);
  let text = result.text.trim().replace(/^["'“”「」[(]+|["'“”」)\]]+$/g, '');
  if (/^\(?unclear\)?$/i.test(text)) text = '';
  return { text, usage };
}
