import { CANONICAL_URL, STORE_ID } from '@/lib/store-identity.mjs';

export function GET() {
  return Response.json({ storeId: STORE_ID, canonicalUrl: CANONICAL_URL });
}
