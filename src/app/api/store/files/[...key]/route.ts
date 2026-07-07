import { requireStaff } from '@/lib/require-staff';
import { getRequestStore } from '@/lib/store-context';
import { contentTypeForKey, getBuffer } from '@/storage/local-store';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Serve tenant files with ACL enforcement.
 *
 * - thumbnails: public (they appear on the shopper page)
 * - shelf photos: staff+ only
 * - videos: not served here (owner/admin download flows only)
 *
 * The store is resolved from the request host, and the key MUST belong to that
 * store — a request on demo.whataisle.com can never read mart2's files.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: segments } = await params;
  const key = segments.join('/');

  const store = await getRequestStore();
  if (!store) {
    return new NextResponse(null, { status: 404 });
  }

  // Key must be scoped to this store's prefix.
  const prefix = `stores/${store.id}/`;
  if (!key.startsWith(prefix)) {
    return new NextResponse(null, { status: 404 });
  }

  const isThumbnail = key.startsWith(`${prefix}thumbnails/`);
  const isVideo = key.startsWith(`${prefix}videos/`);

  if (isVideo) {
    // Videos are platform-internal (requirements §10) — never served here.
    return new NextResponse(null, { status: 404 });
  }

  if (!isThumbnail) {
    // Shelf photos and everything else require a staff session.
    const staff = await requireStaff();
    if (!staff || staff.store.id !== store.id) {
      return new NextResponse(null, { status: 403 });
    }
  }

  const buffer = await getBuffer(key);
  if (!buffer) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentTypeForKey(key),
      'Cache-Control': isThumbnail
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=60',
    },
  });
}
