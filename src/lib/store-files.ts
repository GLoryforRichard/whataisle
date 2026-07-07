/**
 * Build the URL for a stored tenant file. Served by the ACL'd
 * /api/store/files/[...key] route on the store's own subdomain — never a
 * public bucket URL.
 */
export function getStorageUrlForKey(key: string): string {
  return `/api/store/files/${key}`;
}
