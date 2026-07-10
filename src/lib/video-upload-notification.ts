import 'server-only';

import { getBaseUrl } from '@/lib/urls';
import { sendEmail } from '@/mail';
import { getStorageProvider } from '@/storage';
import type { Store } from './store-context';

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // GCS V4 hard maximum

export interface VideoUploadNotificationParams {
  store: Store;
  videoId: string;
  storageKey: string;
  filename: string | null;
  sizeBytes: number | null;
  ownerEmail: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return 'unknown size';
  const mb = sizeBytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Notify the ops inbox that a store walkthrough video finished uploading.
 * Includes a 7-day signed download link (files are up to 5 GB — far past any
 * attachment limit) plus the permanent admin route as fallback. Never throws:
 * a failed notification must not fail the upload response.
 */
export async function notifyVideoUploaded(
  params: VideoUploadNotificationParams
): Promise<void> {
  try {
    const to = process.env.VIDEO_NOTIFY_EMAIL ?? 'lby2024xd@outlook.com';

    let signedUrl: string | null = null;
    try {
      signedUrl = await getStorageProvider().getSignedDownloadUrl(
        params.storageKey,
        SIGNED_URL_TTL_SECONDS
      );
    } catch (error) {
      console.error('[video] signed URL generation failed', error);
    }

    const adminUrl = `${getBaseUrl()}/api/admin/video/${params.videoId}`;
    const storeName = escapeHtml(
      params.store.displayName ?? params.store.handle
    );
    const rows = [
      `<p><strong>Store:</strong> ${storeName} (${escapeHtml(params.store.handle)}.whataisle.com)</p>`,
      `<p><strong>Owner:</strong> ${escapeHtml(params.ownerEmail)}</p>`,
      `<p><strong>File:</strong> ${escapeHtml(params.filename ?? params.videoId)} · ${formatSize(params.sizeBytes)}</p>`,
      `<p><strong>Uploaded:</strong> ${new Date().toISOString()}</p>`,
      signedUrl
        ? `<p><a href="${signedUrl}">Download video</a> (link expires in 7 days)</p>`
        : '<p>Signed link unavailable — use the admin link below.</p>',
      `<p>Permanent (admin login required): <a href="${adminUrl}">${adminUrl}</a></p>`,
    ];

    const result = await sendEmail({
      to,
      subject: `New store video: ${params.store.displayName ?? params.store.handle}`,
      html: rows.join('\n'),
    });
    if (!result.success) {
      console.error('[video] notification email failed', result.error);
    }
  } catch (error) {
    console.error('[video] notification failed', error);
  }
}
