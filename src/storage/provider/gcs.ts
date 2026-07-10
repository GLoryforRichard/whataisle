import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Storage, type Bucket, type FileMetadata } from '@google-cloud/storage';
import { storageConfig } from '../config/storage-config';
import {
  contentTypeForKey,
  normalizeStorageKey,
  normalizeStoragePrefix,
  storageUrlForKey,
} from '../keys';
import {
  ConfigurationError,
  type CreateResumableUploadParams,
  type PutObjectParams,
  type PutObjectResult,
  type ResumableUploadResult,
  type StorageBody,
  type StorageConfig,
  StorageError,
  type StorageObject,
  type StorageObjectMetadata,
  type StorageObjectStream,
  type StorageProvider,
  UploadError,
} from '../types';

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
    Number((error as Error & { code?: number | string }).code) === 404
  );
}

/** Google Cloud Storage provider using ADC and a private bucket. */
export class GcsProvider implements StorageProvider {
  private readonly config: StorageConfig;
  private bucket: Bucket | null = null;

  constructor(config: StorageConfig = storageConfig) {
    this.config = config;
  }

  getProviderName(): 'gcs' {
    return 'gcs';
  }

  private getBucket(): Bucket {
    if (this.bucket) return this.bucket;
    if (!this.config.bucketName) {
      throw new ConfigurationError('Storage bucket name is not configured');
    }
    const storage = new Storage({
      projectId: this.config.projectId || undefined,
    });
    this.bucket = storage.bucket(this.config.bucketName);
    return this.bucket;
  }

  async put(params: PutObjectParams): Promise<PutObjectResult> {
    const key = normalizeStorageKey(params.key);
    const contentType = params.contentType ?? contentTypeForKey(key);
    const file = this.getBucket().file(key);
    try {
      await pipeline(
        toNodeStream(params.data),
        file.createWriteStream({
          resumable: true,
          validation: 'crc32c',
          contentType,
          metadata: {
            contentType,
            cacheControl: params.cacheControl ?? 'private, no-store',
          },
        })
      );
      const [metadata] = await file.getMetadata();
      return {
        ...this.toMetadata(key, metadata),
        url: storageUrlForKey(key),
      };
    } catch (error) {
      throw new UploadError('GCS upload failed', { cause: error });
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    const normalizedKey = normalizeStorageKey(key);
    const file = this.getBucket().file(normalizedKey);
    try {
      const [[data], [metadata]] = await Promise.all([
        file.download(),
        file.getMetadata(),
      ]);
      return { ...this.toMetadata(normalizedKey, metadata), data };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageError('GCS download failed', { cause: error });
    }
  }

  async stream(key: string): Promise<StorageObjectStream | null> {
    const normalizedKey = normalizeStorageKey(key);
    const file = this.getBucket().file(normalizedKey);
    try {
      const [metadata] = await file.getMetadata();
      const body = Readable.toWeb(
        file.createReadStream({ validation: true })
      ) as ReadableStream<Uint8Array>;
      return { ...this.toMetadata(normalizedKey, metadata), body };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageError('GCS streaming download failed', { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    const normalizedKey = normalizeStorageKey(key);
    try {
      await this.getBucket()
        .file(normalizedKey)
        .delete({ ignoreNotFound: true });
    } catch (error) {
      throw new StorageError('GCS delete failed', { cause: error });
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    try {
      await this.getBucket().deleteFiles({
        prefix: normalizeStoragePrefix(prefix),
        force: true,
      });
    } catch (error) {
      throw new StorageError('GCS prefix delete failed', { cause: error });
    }
  }

  async getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const normalizedKey = normalizeStorageKey(key);
    // V4 signatures cap at 7 days; signing uses IAM signBlob under ADC, so
    // the runtime service account needs iam.serviceAccountTokenCreator.
    const expires = Date.now() + Math.min(ttlSeconds, 604800) * 1000;
    try {
      const [url] = await this.getBucket()
        .file(normalizedKey)
        .getSignedUrl({ version: 'v4', action: 'read', expires });
      return url;
    } catch (error) {
      throw new StorageError('GCS signed URL generation failed', {
        cause: error,
      });
    }
  }

  async createResumableUpload(
    params: CreateResumableUploadParams
  ): Promise<ResumableUploadResult> {
    const key = normalizeStorageKey(params.key);
    try {
      const [uploadUrl] = await this.getBucket()
        .file(key)
        .createResumableUpload({
          origin: params.origin,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: params.contentType,
            cacheControl: 'private, no-store',
          },
        });
      return {
        strategy: 'direct',
        key,
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': params.contentType },
      };
    } catch (error) {
      throw new UploadError('Could not create GCS upload session', {
        cause: error,
      });
    }
  }

  private toMetadata(
    key: string,
    metadata: FileMetadata
  ): StorageObjectMetadata {
    return {
      key,
      size: Number(metadata.size ?? 0),
      contentType: metadata.contentType ?? contentTypeForKey(key),
      etag: metadata.etag,
    };
  }
}
