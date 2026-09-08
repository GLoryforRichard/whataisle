import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

/** Shared wire format with the per-store runtime; never import into a client. */
export async function hashStorePin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error('Enter a six-digit store password');
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(pin, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export function secretDigest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function matchesSecret(value: string, digest: string | null) {
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(
    Buffer.from(secretDigest(value), 'hex'),
    Buffer.from(digest, 'hex')
  );
}

export function newSecret() {
  return randomBytes(32).toString('base64url');
}
