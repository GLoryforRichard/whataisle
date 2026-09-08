import 'server-only';

import { matchesSecret, secretDigest } from './store-secrets';

export function isProvisioningWorker(request: Request) {
  const configured = process.env.PROVISIONING_WORKER_TOKEN;
  if (!configured || configured.length < 32) return false;
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return false;
  return matchesSecret(authorization.slice(7), secretDigest(configured));
}
