export function hashStorePin(pin: string, salt?: string): string;
export function verifyStorePin(pin: string, encoded: string): boolean;
export function signStoreSession(
  data: { storeId: string; pinVersion: number; role: 'staff' | 'owner'; expiresAt: number },
  secret: string
): string;
export function verifyStoreSession(
  token: string | undefined,
  data: {
    storeId: string;
    pinVersion: number;
    role: 'staff' | 'owner';
    secret: string;
    now?: number;
  }
): boolean;
