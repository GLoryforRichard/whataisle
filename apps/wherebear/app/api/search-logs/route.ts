import { NextRequest } from 'next/server';
import { authorizeStoreRequest } from '@/lib/store-runtime';
import { NextResponse } from 'next/server';
import { getRecentSearches } from '@/lib/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeDenied = await authorizeStoreRequest(req);
  if (storeDenied) return storeDenied;
  try {
    const logs = await getRecentSearches(100);
    return NextResponse.json({ ok: true, logs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
