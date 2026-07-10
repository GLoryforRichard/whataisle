import type { Readable } from 'node:stream';

/** Storage backends supported by the server. */
export type StorageProviderName = 'gcs' | 'local' | 's3';

/**
 * Storage configuration. GCS uses Application Default Credentials, while the
 * access-key fields are only required by the S3-compatible provider.
 */
export interface StorageConfig {
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl?: string;
  projectId?: string;
}

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export class ConfigurationError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class UploadError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UploadError';
  }
}

export type StorageBody =
  | Blob
  | Buffer
  | Readable
  | ReadableStream<Uint8Array>
  | Uint8Array;

export interface PutObjectParams {
  /** Private object key. Keys are normalized and traversal is rejected. */
  key: string;
  data: StorageBody;
  contentType?: string;
  cacheControl?: string;
  /** Required by some streaming S3-compatible backends. */
  contentLength?: number;
}

export interface StorageObjectMetadata {
  key: string;
  size: number;
  contentType: string;
  etag?: string;
}

export interface PutObjectResult extends StorageObjectMetadata {
  /** ACL-enforcing application URL. Objects are never made public. */
  url: string;
}

export interface StorageObject extends StorageObjectMetadata {
  data: Buffer;
}

export interface StorageObjectStream extends StorageObjectMetadata {
  body: ReadableStream<Uint8Array>;
}

export interface CreateResumableUploadParams {
  key: string;
  contentType: string;
  contentLength?: number;
  /** Browser origin allowed to use a provider-issued upload session. */
  origin?: string;
}

/**
 * GCS returns `direct`; local and S3 use the application's idempotent chunk
 * API as a compatible fallback.
 */
export type ResumableUploadResult =
  | {
      strategy: 'direct';
      key: string;
      uploadUrl: string;
      method: 'PUT';
      headers: Record<string, string>;
    }
  | {
      strategy: 'chunked';
      key: string;
      uploadUrl: null;
      method: 'POST';
      headers: Record<string, never>;
    };

/** Legacy browser upload parameters retained for the generic upload route. */
export interface UploadFileParams {
  file: Buffer | Blob;
  filename: string;
  contentType: string;
  folder?: string;
}

export interface UploadFileResult {
  url: string;
  key: string;
}

/** Unified private-object storage contract used by all tenant file paths. */
export interface StorageProvider {
  put(params: PutObjectParams): Promise<PutObjectResult>;
  get(key: string): Promise<StorageObject | null>;
  stream(key: string): Promise<StorageObjectStream | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  createResumableUpload(
    params: CreateResumableUploadParams
  ): Promise<ResumableUploadResult>;
  /**
   * Time-limited download URL for a private object. GCS signs a V4 URL
   * (max TTL 7 days); local/s3 fall back to the ACL-enforcing app URL.
   */
  getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  getProviderName(): StorageProviderName;
}
