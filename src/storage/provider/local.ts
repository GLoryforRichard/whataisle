import { nanoid } from 'nanoid';
import { putBuffer } from '../local-store';
import type {
  StorageProvider,
  UploadFileParams,
  UploadFileResult,
} from '../types';

/**
 * Local-disk storage provider (dev / GCP-agnostic). Delegates to local-store
 * and returns a key + a URL that points at the ACL'd file-serving route rather
 * than a public bucket URL.
 */
export class LocalProvider implements StorageProvider {
  getProviderName(): string {
    return 'local';
  }

  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    const { file, filename, folder } = params;
    const buffer = Buffer.isBuffer(file)
      ? file
      : Buffer.from(await (file as Blob).arrayBuffer());
    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.'))
      : '';
    const key = `${folder ? `${folder.replace(/^\/|\/$/g, '')}/` : ''}${nanoid()}${ext}`;
    const { key: storedKey } = await putBuffer(key, buffer);
    return { key: storedKey, url: `/api/store/files/${storedKey}` };
  }

  async deleteFile(key: string): Promise<void> {
    const { deleteObject } = await import('../local-store');
    await deleteObject(key);
  }
}
