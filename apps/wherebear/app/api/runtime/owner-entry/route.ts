import { NextRequest, NextResponse } from 'next/server';
import {
  getStoreRuntime,
  isSameStoreOrigin,
  platformRequest,
  runtimeDenied,
  setStoreSession,
} from '@/lib/store-runtime';
export async function POST(req: NextRequest) {
  if (!isSameStoreOrigin(req)) return runtimeDenied(403, 'Please use this store’s own page.');
  try {
    const { token } = await req.json();
    if (typeof token !== 'string' || token.length > 256)
      return runtimeDenied(400, 'Invalid owner entry');
    const config = await getStoreRuntime();
    if (!config.accessAllowed) return runtimeDenied(402, 'Store subscription is inactive.');
    const response = await platformRequest('/owner-entry', { token });
    if (!response.ok)
      return runtimeDenied(403, 'This owner link expired. Open a new link from your dashboard.');
    const data = await response.json();
    if (data.allowed !== true || data.pinVersion !== config.pinVersion)
      return runtimeDenied(403, 'Owner entry is no longer valid.');
    const result = NextResponse.json({ ok: true });
    setStoreSession(result, config, 'owner');
    return result;
  } catch {
    return runtimeDenied(503, 'Unable to open the owner editor.');
  }
}
