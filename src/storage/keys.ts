import path from 'node:path';
import { StorageError } from './types';

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/** Reject absolute, empty, traversal, backslash, and control-character keys. */
export function normalizeStorageKey(key: string): string {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    hasControlCharacters(key)
  ) {
    throw new StorageError('Invalid storage key');
  }

  const segments = key.split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new StorageError('Invalid storage key');
  }
  return segments.join('/');
}

/** Prefixes always end in `/`, preventing sibling-prefix deletion. */
export function normalizeStoragePrefix(prefix: string): string {
  return `${normalizeStorageKey(prefix.replace(/\/+$/, ''))}/`;
}

export function storageUrlForKey(key: string): string {
  return `/api/store/files/${normalizeStorageKey(key)
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export function storeStoragePrefix(storeId: string): string {
  return normalizeStoragePrefix(`stores/${storeId}`);
}

export function isStoreStorageKey(key: string, storeId: string): boolean {
  try {
    return normalizeStorageKey(key).startsWith(storeStoragePrefix(storeId));
  } catch {
    return false;
  }
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
    case '.json':
      return 'application/json';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

export function sanitizeStorageFolder(folder?: string): string | undefined {
  if (!folder) return undefined;
  const segments = folder
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter((segment) => segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : undefined;
}
