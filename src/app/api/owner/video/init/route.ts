import { mappingRepo } from '@/data/mapping-repo';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  filename: z.string().max(255).optional(),
  totalChunks: z.number().int().positive().max(10000),
});

/**
 * Start a resumable walk-through video upload. Returns a videoId + storage key
 * prefix; chunks are POSTed to /api/owner/video/chunk.
 */
export async function POST(req: Request) {
  const store = await requireOwnerStore();
  if (!store) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const videoId = await mappingRepo(store.id).createVideo({
    storageKey: '', // final key set on complete
    filename: parsed.data.filename ?? null,
    totalChunks: parsed.data.totalChunks,
  });

  return NextResponse.json({ videoId });
}
