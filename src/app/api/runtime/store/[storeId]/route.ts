import { authenticateStoreRuntime } from '@/data/runtime-access';
import { getBaseUrl } from '@/lib/urls';
import { getStoreServiceAccess } from '@/payment/store-billing';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const context = await authenticateStoreRuntime(storeId, request);
  if (!context)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getStoreServiceAccess(storeId);
  const cleanup = !!context.runtime.cleanupRequestedAt;
  return Response.json(
    {
      storeId,
      handle: context.tenant.handle,
      displayName: context.tenant.displayName,
      pinHash: context.tenant.staffPinHash,
      pinVersion: context.tenant.pinVersion,
      ...access,
      accessAllowed: access.accessAllowed && !cleanup,
      setupAllowed: access.setupAllowed && !cleanup,
      recoveryUrl: `${getBaseUrl()}/dashboard`,
    },
    { headers: { 'Cache-Control': 'no-store, private' } }
  );
}
