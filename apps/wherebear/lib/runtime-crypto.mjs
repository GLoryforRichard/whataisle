import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashStorePin(pin, salt = randomBytes(16).toString('hex')) {
  if (!/^\d{6}$/.test(pin)) throw new Error('A six-digit PIN is required');
  return `scrypt$${salt}$${scryptSync(pin, salt, 64).toString('hex')}`;
}
export function verifyStorePin(pin, encoded) {
  if (!/^\d{6}$/.test(pin) || typeof encoded !== 'string') return false;
  const [algorithm, salt, expected, extra] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    !/^[a-f0-9]{32}$/.test(salt || '') ||
    !/^[a-f0-9]{128}$/.test(expected || '') ||
    extra
  )
    return false;
  return timingSafeEqual(scryptSync(pin, salt, 64), Buffer.from(expected, 'hex'));
}
export function signStoreSession({ storeId, pinVersion, role, expiresAt }, secret) {
  if (!secret || secret.length < 32) throw new Error('Store session secret is unavailable');
  const payload = Buffer.from(JSON.stringify({ storeId, pinVersion, role, expiresAt })).toString(
    'base64url'
  );
  return `${payload}.${createHmac('sha256', secret).update(`whataisle-session-v1:${payload}`).digest('base64url')}`;
}
export function verifyStoreSession(token, { storeId, pinVersion, role, secret, now = Date.now() }) {
  if (!token || !secret || secret.length < 32 || token.length > 1024) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', secret)
    .update(`whataisle-session-v1:${payload}`)
    .digest('base64url');
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return (
      data.storeId === storeId &&
      data.pinVersion === pinVersion &&
      data.role === role &&
      Number.isFinite(data.expiresAt) &&
      data.expiresAt > now
    );
  } catch {
    return false;
  }
}
