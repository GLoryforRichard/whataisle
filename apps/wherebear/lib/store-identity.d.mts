export const STORE_ID: 'wherebear';
export const CANONICAL_URL: 'https://wherebear.whataisle.com';
export const LEGACY_HOSTS: string[];
export function classifyStoreHost(host: string | null): 'canonical' | 'legacy' | 'local' | 'foreign';
export function canonicalLocation(pathname: string, search?: string): string;
