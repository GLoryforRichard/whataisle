import { isProvisioningWorker } from '@/lib/provisioning-auth';
import { reconcileStoreBilling } from '@/payment/store-billing';

export async function POST(request: Request) {
  if (!isProvisioningWorker(request))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await reconcileStoreBilling();
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: 'Billing reconciliation failed; retry required' },
      { status: 503 }
    );
  }
}
