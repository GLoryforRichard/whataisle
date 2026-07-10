import 'server-only';

import { isIP } from 'node:net';

/**
 * Resolve a client IP without trusting an attacker-prepended X-Forwarded-For
 * value. Google Cloud's external load balancer appends client and proxy IPs, so
 * the client is the second-to-last hop. Production ingress must be restricted
 * to that load balancer before TRUST_GCP_LOAD_BALANCER is enabled.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const candidate =
    process.env.TRUST_GCP_LOAD_BALANCER === 'true'
      ? forwarded?.at(-2)
      : headers.get('x-real-ip') || forwarded?.[0];

  return candidate && isIP(candidate) ? candidate : 'unknown';
}
