import { NextRequest, NextResponse } from 'next/server';
import { getStoreRuntime, hasStoreSession, runtimeDenied } from '@/lib/store-runtime';
import { getStoreMap } from '@/lib/store-map';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const config = await getStoreRuntime();
    return NextResponse.json(
      {
        ok: true,
        storeId: config.storeId,
        displayName: config.displayName,
        managed: config.managed,
        accessAllowed: config.accessAllowed,
        setupAllowed: config.setupAllowed,
        recoveryUrl: config.recoveryUrl,
        pinLength: 6,
        staffAuthorized: hasStoreSession(req, config),
        ownerAuthorized: hasStoreSession(req, config, 'owner'),
        map: config.accessAllowed ? await getStoreMap() : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return runtimeDenied(503, 'Store temporarily unavailable. Please try again.');
  }
}
