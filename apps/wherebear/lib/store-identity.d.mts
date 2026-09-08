export const STORE_ID: string;
export const CANONICAL_URL: string;
export const LEGACY_HOSTS: string[];
export function classifyStoreHost(host: string | null): 'canonical' | 'legacy' | 'local' | 'foreign';
export function canonicalLocation(pathname: string, search?: string): string;
