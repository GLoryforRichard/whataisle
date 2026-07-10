import { Readable } from 'node:stream';
import { S3mini } from 's3mini';
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
  type StorageObjectStream,
  type StorageProvider,
  UploadError,
} from '../types';

function isWebStream(data: StorageBody): data is ReadableStream<Uint8Array> {
  return 'getReader' in data && typeof data.getReader === 'function';
}

function toS3Body(
  data: StorageBody
): Blob | Buffer | ReadableStream<Uint8Array> | Uint8Array {
  if (data instanceof Readable) {
    return Readable.toWeb(data) as ReadableStream<Uint8Array>;
  }
  if (isWebStream(data)) return data;
  return data;
}

/** Private S3-compatible object provider (for R2 and legacy deployments). */
export class S3Provider implements StorageProvider {
  private readonly config: StorageConfig;
  private s3Client: S3mini | null = null;

  constructor(config: StorageConfig = storageConfig) {
    this.config = config;
  }

  getProviderName(): 's3' {
    return 's3';
  }

  private getS3Client(): S3mini {
    if (this.s3Client) return this.s3Client;

    const { region, endpoint, accessKeyId, secretAccessKey, bucketName } =
      this.config;
    if (!region) {
      throw new ConfigurationError('Storage region is not configured');
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new ConfigurationError('Storage credentials are not configured');
    }
    if (!endpoint) {
      throw new ConfigurationError('Storage endpoint is required for s3mini');
    }
    if (!bucketName) {
      throw new ConfigurationError('Storage bucket name is not configured');
    }

    this.s3Client = new S3mini({
      accessKeyId,
      secretAccessKey,
      endpoint: `${endpoint.replace(/\/$/, '')}/${bucketName}`,
      region,
    });
    return this.s3Client;
  }

  async put(params: PutObjectParams): Promise<PutObjectResult> {
    const key = normalizeStorageKey(params.key);
    const contentType = params.contentType ?? contentTypeForKey(key);
    try {
      const response = await this.getS3Client().putAnyObject(
        key,
        toS3Body(params.data),
        contentType,
        undefined,
        undefined,
        params.contentLength
      );
      if (!response.ok) {
        throw new UploadError(
          `S3 upload failed with status ${response.status}`
        );
      }
      return {
        key,
        size: params.contentLength ?? this.bodySize(params.data),
        contentType,
        etag: response.headers.get('etag') ?? undefined,
        url: storageUrlForKey(key),
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new UploadError('S3 upload failed', { cause: error });
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    const normalizedKey = normalizeStorageKey(key);
    try {
      const response =
        await this.getS3Client().getObjectResponse(normalizedKey);
      if (!response) return null;
      const data = Buffer.from(await response.arrayBuffer());
      return {
        key: normalizedKey,
        data,
        size: data.length,
        contentType:
          response.headers.get('content-type') ??
          contentTypeForKey(normalizedKey),
        etag: response.headers.get('etag') ?? undefined,
      };
    } catch (error) {
      throw new StorageError('S3 download failed', { cause: error });
    }
  }

  async stream(key: string): Promise<StorageObjectStream | null> {
    const normalizedKey = normalizeStorageKey(key);
    try {
      const response =
        await this.getS3Client().getObjectResponse(normalizedKey);
      if (!response?.body) return null;
      return {
        key: normalizedKey,
        body: response.body,
        size: Number(response.headers.get('content-length') ?? 0),
        contentType:
          response.headers.get('content-type') ??
          contentTypeForKey(normalizedKey),
        etag: response.headers.get('etag') ?? undefined,
      };
    } catch (error) {
      throw new StorageError('S3 streaming download failed', { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.getS3Client().deleteObject(normalizeStorageKey(key));
    } catch (error) {
      throw new StorageError('S3 delete failed', { cause: error });
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const normalizedPrefix = normalizeStoragePrefix(prefix);
    try {
      const keys = await this.listKeysRecursively(normalizedPrefix);
      if (keys.length > 0) await this.getS3Client().deleteObjects(keys);
    } catch (error) {
      throw new StorageError('S3 prefix delete failed', { cause: error });
    }
  }

  async createResumableUpload(
    params: CreateResumableUploadParams
  ): Promise<ResumableUploadResult> {
    // The application chunk endpoint remains the S3-compatible fallback.
    return {
      strategy: 'chunked',
      key: normalizeStorageKey(params.key),
      uploadUrl: null,
      method: 'POST',
      headers: {},
    };
  }

  private bodySize(data: StorageBody): number {
    if (data instanceof Blob) return data.size;
    if (data instanceof Uint8Array) return data.byteLength;
    return 0;
  }

  private async listKeysRecursively(prefix: string): Promise<string[]> {
    const objects = await this.getS3Client().listObjects('/', prefix);
    if (!objects) return [];

    const keys: string[] = [];
    for (const object of objects) {
      if (object.Size === 0 && object.Key.endsWith('/')) {
        keys.push(...(await this.listKeysRecursively(object.Key)));
      } else {
        keys.push(object.Key);
      }
    }
    return keys;
  }
}
