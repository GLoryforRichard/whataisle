import { NextRequest, NextResponse } from 'next/server';
import {
  checkStorePin,
  getStoreRuntime,
  hasStoreSession,
  isSameStoreOrigin,
  runtimeDenied,
  setStoreSession,
} from '@/lib/store-runtime';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const config = await getStoreRuntime();
    return NextResponse.json(
      { ok: config.accessAllowed && hasStoreSession(req, config) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return runtimeDenied(503, 'Store temporarily unavailable.');
  }
}
export async function POST(req: NextRequest) {
  try {
    const config = await getStoreRuntime();
    if (!config.accessAllowed)
      return runtimeDenied(402, 'Store subscription is inactive.', {
        recoveryUrl: config.recoveryUrl,
      });
    const body = await req.json();
    const denied = await checkStorePin(req, config, body.pin);
    if (denied) return denied;
    const response = NextResponse.json({ ok: true });
    setStoreSession(response, config);
    return response;
  } catch {
    return runtimeDenied(503, 'Unable to verify the store password. Please try again.');
  }
}
export async function DELETE(req: NextRequest) {
  if (!isSameStoreOrigin(req)) return runtimeDenied(403, 'Please use this store’s own page.');
  const response = NextResponse.json({ ok: true });
  response.cookies.set('wa_staff', '', { path: '/', maxAge: 0, httpOnly: true });
  return response;
}
