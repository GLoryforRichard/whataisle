export const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 30 * 60;
export const MAX_VIDEO_CHUNKS = Math.ceil(MAX_VIDEO_BYTES / VIDEO_CHUNK_BYTES);

export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number];

export function videoTypeFromFilename(
  filename?: string
): VideoContentType | null {
  if (!filename) return 'video/mp4';
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  return null;
}

export function extensionForVideoType(type: VideoContentType): 'mov' | 'mp4' {
  return type === 'video/quicktime' ? 'mov' : 'mp4';
}
