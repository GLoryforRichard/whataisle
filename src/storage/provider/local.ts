import {
  deleteLocalObject,
  deleteLocalPrefix,
  getLocalObject,
  putLocalObject,
  streamLocalObject,
} from '../local-store';
import { normalizeStorageKey, storageUrlForKey } from '../keys';
import type {
  CreateResumableUploadParams,
  PutObjectParams,
  PutObjectResult,
  ResumableUploadResult,
  StorageObject,
  StorageObjectStream,
  StorageProvider,
} from '../types';

/** Local filesystem provider for development and E2E. */
export class LocalProvider implements StorageProvider {
  getProviderName(): 'local' {
    return 'local';
  }

  async put(params: PutObjectParams): Promise<PutObjectResult> {
    const metadata = await putLocalObject(params.key, params.data);
    return {
      ...metadata,
      contentType: params.contentType ?? metadata.contentType,
      url: storageUrlForKey(metadata.key),
    };
  }

  async get(key: string): Promise<StorageObject | null> {
    const object = await getLocalObject(key);
    if (!object) return null;
    return { ...object.metadata, data: object.data };
  }

  async stream(key: string): Promise<StorageObjectStream | null> {
    const object = await streamLocalObject(key);
    if (!object) return null;
    return { ...object.metadata, body: object.body };
  }

  async delete(key: string): Promise<void> {
    await deleteLocalObject(normalizeStorageKey(key));
  }

  async deletePrefix(prefix: string): Promise<void> {
    await deleteLocalPrefix(prefix);
  }

  async createResumableUpload(
    params: CreateResumableUploadParams
  ): Promise<ResumableUploadResult> {
    // The owner video chunk API is persistent and idempotent in local mode.
    return {
      strategy: 'chunked',
      key: normalizeStorageKey(params.key),
      uploadUrl: null,
      method: 'POST',
      headers: {},
    };
  }
}
