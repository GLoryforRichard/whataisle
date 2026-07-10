import 'server-only';

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';
import { contentTypeForKey, normalizeStorageKey } from './keys';
import type { StorageBody, StorageObjectMetadata } from './types';

/** Low-level local-disk primitives used only by LocalProvider. */

function baseDir(): string {
  // A static project subdirectory keeps Next file tracing bounded. Production
  // uses GCS; local storage is intentionally a development/E2E backend.
  return path.join(process.cwd(), '.storage');
}

function keyToPath(key: string): string {
  return path.join(baseDir(), normalizeStorageKey(key));
}

function isWebStream(data: StorageBody): data is ReadableStream<Uint8Array> {
  return 'getReader' in data && typeof data.getReader === 'function';
}

function toNodeStream(data: StorageBody): Readable {
  if (data instanceof Readable) return data;
  if (data instanceof Blob) {
    return Readable.fromWeb(
      data.stream() as unknown as NodeReadableStream<Uint8Array>
    );
  }
  if (isWebStream(data)) {
    return Readable.fromWeb(data as unknown as NodeReadableStream<Uint8Array>);
  }
  return Readable.from([data]);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function putLocalObject(
  key: string,
  data: StorageBody
): Promise<StorageObjectMetadata> {
  const normalizedKey = normalizeStorageKey(key);
  const filePath = keyToPath(normalizedKey);
  const tempPath = `${filePath}.${randomUUID()}.upload`;
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await pipeline(
      toNodeStream(data),
      createWriteStream(tempPath, { flags: 'wx' })
    );
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const info = await stat(filePath);
  return {
    key: normalizedKey,
    size: info.size,
    contentType: contentTypeForKey(normalizedKey),
  };
}

export async function getLocalObject(
  key: string
): Promise<{ metadata: StorageObjectMetadata; data: Buffer } | null> {
  const normalizedKey = normalizeStorageKey(key);
  try {
    const [data, info] = await Promise.all([
      readFile(keyToPath(normalizedKey)),
      stat(keyToPath(normalizedKey)),
    ]);
    return {
      data,
      metadata: {
        key: normalizedKey,
        size: info.size,
        contentType: contentTypeForKey(normalizedKey),
      },
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function streamLocalObject(key: string): Promise<{
  metadata: StorageObjectMetadata;
  body: ReadableStream<Uint8Array>;
} | null> {
  const normalizedKey = normalizeStorageKey(key);
  try {
    const info = await stat(keyToPath(normalizedKey));
    const body = Readable.toWeb(
      createReadStream(keyToPath(normalizedKey))
    ) as ReadableStream<Uint8Array>;
    return {
      body,
      metadata: {
        key: normalizedKey,
        size: info.size,
        contentType: contentTypeForKey(normalizedKey),
      },
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function deleteLocalObject(key: string): Promise<void> {
  try {
    await unlink(keyToPath(key));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function deleteLocalPrefix(prefix: string): Promise<void> {
  const normalizedPrefix = normalizeStorageKey(prefix.replace(/\/+$/, ''));
  await rm(keyToPath(normalizedPrefix), { force: true, recursive: true });
}

// Compatibility helpers for code outside the tenant object paths.
export async function putBuffer(
  key: string,
  data: Buffer
): Promise<{ key: string }> {
  const result = await putLocalObject(key, data);
  return { key: result.key };
}

export async function getBuffer(key: string): Promise<Buffer | null> {
  return (await getLocalObject(key))?.data ?? null;
}

export function getReadStream(key: string): NodeJS.ReadableStream {
  return createReadStream(keyToPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  await deleteLocalObject(key);
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

export { contentTypeForKey } from './keys';
