import {
  claimStoreJob,
  failStoreJob,
  finishStoreJob,
  registerRuntimeCredentials,
  renewStoreLease,
} from '@/data/store-provisioning';
import { isProvisioningWorker } from '@/lib/provisioning-auth';
import { z } from 'zod';

const lease = z.object({
  jobId: z.string().uuid(),
  leaseToken: z.string().min(32).max(128),
});
const credentials = lease.extend({
  runtimeTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  port: z.number().int().min(3100).max(65000),
});
const complete = z.union([
  credentials.extend({
    kind: z.literal('provision').optional(),
    runtimeVersion: z.string().min(1).max(100),
    canonicalUrl: z.url(),
  }),
  credentials.extend({
    kind: z.literal('activate'),
    canonicalUrl: z.url(),
  }),
  lease.extend({
    kind: z.literal('archive'),
    archivedAt: z.string().optional(),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> }
) {
  if (!isProvisioningWorker(request))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { operation } = await params;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 8192)
      return new Response(null, { status: 413 });
    const input = await request.json();
    switch (operation) {
      case 'claim': {
        const data = z
          .object({
            workerId: z.string().min(1).max(100),
            leaseSeconds: z.number().int().min(60).max(300).default(300),
          })
          .parse(input);
        return Response.json({
          job: await claimStoreJob(data.workerId, data.leaseSeconds),
        });
      }
      case 'heartbeat': {
        const data = lease.parse(input);
        return Response.json(
          await renewStoreLease(data.jobId, data.leaseToken)
        );
      }
      case 'credentials':
        await registerRuntimeCredentials(credentials.parse(input));
        break;
      case 'complete':
        return Response.json(await finishStoreJob(complete.parse(input)));
      case 'fail':
        await failStoreJob(
          lease
            .extend({
              code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
              retryable: z.boolean(),
            })
            .parse(input)
        );
        break;
      default:
        return Response.json({ error: 'Unknown operation' }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? 'Invalid request'
            : 'Job operation failed; retry or check lease',
      },
      { status: error instanceof z.ZodError ? 400 : 409 }
    );
  }
}
