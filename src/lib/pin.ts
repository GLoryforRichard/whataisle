import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Staff PIN hashing (scrypt — no native dependencies).
 *
 * Kept free of 'server-only' so the seed script (plain node via tsx) can
 * import it; never import this from client components.
 */

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(pin, salt, 32)) as Buffer;
  return `s2:${salt}:${derived.toString('hex')}`;
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const [scheme, salt, expected] = hash.split(':');
  if (scheme !== 's2' || !salt || !expected) return false;
  const derived = (await scryptAsync(pin, salt, 32)) as Buffer;
  const expectedBuf = Buffer.from(expected, 'hex');
  return (
    derived.length === expectedBuf.length &&
    timingSafeEqual(derived, expectedBuf)
  );
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
