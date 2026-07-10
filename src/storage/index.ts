import 'server-only';

import { websiteConfig } from '@/config/website';
import { nanoid } from 'nanoid';
import { storageConfig } from './config/storage-config';
import {
  contentTypeForKey,
  sanitizeStorageFolder,
  storageUrlForKey,
} from './keys';
import { GcsProvider } from './provider/gcs';
import { LocalProvider } from './provider/local';
import { S3Provider } from './provider/s3';
import type {
  StorageConfig,
  StorageProvider,
  StorageProviderName,
  UploadFileResult,
} from './types';

export const defaultStorageConfig: StorageConfig = storageConfig;

type StorageProviderFactory = () => StorageProvider;

const providerRegistry: Record<StorageProviderName, StorageProviderFactory> = {
  gcs: () => new GcsProvider(),
  local: () => new LocalProvider(),
  s3: () => new S3Provider(),
};

let storageProvider: StorageProvider | null = null;

function configuredProviderName(): StorageProviderName {
  const name =
    process.env.STORAGE_PROVIDER ?? String(websiteConfig.storage.provider);
  if (!(name in providerRegistry)) {
    throw new Error(`Unsupported storage provider: ${name}.`);
  }
  return name as StorageProviderName;
}

export function getStorageProvider(): StorageProvider {
  if (!storageProvider) {
    storageProvider = providerRegistry[configuredProviderName()]();
  }
  return storageProvider;
}

/** Legacy generic upload helper, backed by the unified private-object API. */
export async function uploadFile(
  file: Buffer | Blob,
  filename: string,
  contentType: string,
  folder?: string
): Promise<UploadFileResult> {
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : '';
  const safeExtension = /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '';
  const safeFolder = sanitizeStorageFolder(folder);
  const key = `${safeFolder ? `${safeFolder}/` : ''}${nanoid()}${safeExtension}`;
  const result = await getStorageProvider().put({
    key,
    data: file,
    contentType,
  });
  return { key: result.key, url: storageUrlForKey(result.key) };
}

export async function deleteFile(key: string): Promise<void> {
  await getStorageProvider().delete(key);
}

export { contentTypeForKey };
export {
  isStoreStorageKey,
  normalizeStorageKey,
  normalizeStoragePrefix,
  storeStoragePrefix,
} from './keys';
export type * from './types';
