import { consumeOwnerMapEntry } from '@/data/owner-store';
import { authenticateStoreRuntime } from '@/data/runtime-access';
import { getStoreServiceAccess } from '@/payment/store-billing';
import { z } from 'zod';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const context = await authenticateStoreRuntime(storeId, request);
  if (!context) return Response.json({ allowed: false }, { status: 401 });
  const access = await getStoreServiceAccess(storeId);
  if (!access.accessAllowed || context.runtime.cleanupRequestedAt)
    return Response.json({ allowed: false }, { status: 403 });
  try {
    const { token } = z
      .object({ token: z.string().min(32).max(128) })
      .parse(await request.json());
    const allowed = await consumeOwnerMapEntry(
      storeId,
      token,
      context.tenant.pinVersion
    );
    return Response.json(
      { allowed, pinVersion: context.tenant.pinVersion },
      { status: allowed ? 200 : 403, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return Response.json({ allowed: false }, { status: 400 });
  }
}
