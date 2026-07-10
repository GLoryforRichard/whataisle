import { requireStaff } from '@/lib/require-staff';
import { getRequestStore } from '@/lib/store-context';
import {
  contentTypeForKey,
  getStorageProvider,
  isStoreStorageKey,
} from '@/storage';
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

  // The provider also rejects traversal; this check binds the key to the host.
  const prefix = `stores/${store.id}/`;
  if (!isStoreStorageKey(key, store.id)) {
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

  const object = await getStorageProvider().stream(key);
  if (!object) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(object.body, {
    headers: {
      'Content-Type': object.contentType || contentTypeForKey(key),
      'Content-Length': String(object.size),
      'Cache-Control': isThumbnail
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=60',
    },
  });
}
