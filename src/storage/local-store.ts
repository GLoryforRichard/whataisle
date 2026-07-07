import 'server-only';

import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk store for tenant files (shelf photos, thumbnails, logos, videos).
 *
 * Keys are POSIX-style paths (e.g. "stores/<id>/thumbnails/<id>.jpg") and map
 * to files under STORAGE_LOCAL_DIR. Everything is served through the ACL'd
 * /api/store/files/[...key] route — never a public bucket URL — because the
 * shopper page is the largest photo-leak surface (requirements §10).
 *
 * The GCS driver drops in later behind the same key contract.
 */

function baseDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.STORAGE_LOCAL_DIR ?? './.storage'
  );
}

/** Reject keys that could escape the storage root. */
function safeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^(\.\.(\/|$))+/, '');
  if (normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return normalized;
}

function keyToPath(key: string): string {
  return path.join(baseDir(), safeKey(key));
}

export async function putBuffer(
  key: string,
  data: Buffer
): Promise<{ key: string }> {
  const filePath = keyToPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
  return { key: safeKey(key) };
}

export async function getBuffer(key: string): Promise<Buffer | null> {
  try {
    return await readFile(keyToPath(key));
  } catch {
    return null;
  }
}

export function getReadStream(key: string): NodeJS.ReadableStream {
  return createReadStream(keyToPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await unlink(keyToPath(key));
  } catch {
    // Already gone — deletion is idempotent.
  }
}

/** Decode a data URL (data:image/jpeg;base64,....) to a Buffer. */
export function dataUrlToBuffer(dataUrl: string): {
  buffer: Buffer;
  contentType: string;
} | null {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}
