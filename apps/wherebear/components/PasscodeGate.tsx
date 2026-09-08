'use client';

import { useState, useEffect } from 'react';
import { C, FONT } from '@/lib/theme';
import { useStoreRuntime } from './StoreRuntimeProvider';

/** Only the server can issue a workspace session; browser flags never authorize a request. */
export default function PasscodeGate({
  cancelHref = '/',
  children,
}: {
  cancelHref?: string;
  children: React.ReactNode;
}) {
  const { store, refresh } = useStoreRuntime();
  const [unlocked, setUnlocked] = useState(store.staffAuthorized);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setUnlocked(store.staffAuthorized);
  }, [store.staffAuthorized]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/staff/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: entry }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Please try again');
      setEntry('');
      setUnlocked(true);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to verify password');
      setEntry('');
    } finally {
      setBusy(false);
    }
  };
  if (unlocked) return <>{children}</>;
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: C.bg,
        fontFamily: FONT,
        color: C.text,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: 25 }}>{store.displayName}</h1>
        <h2 style={{ fontSize: 20 }}>员工工作台 / Staff workspace</h2>
        <label htmlFor="store-pin">输入商店密码 / Enter store password</label>
        <input
          id="store-pin"
          aria-label="Store password"
          autoFocus
          type="password"
          inputMode="numeric"
          pattern={`[0-9]{${store.pinLength}}`}
          required
          minLength={store.pinLength}
          maxLength={store.pinLength}
          autoComplete="off"
          value={entry}
          onChange={(e) => setEntry(e.target.value.replace(/\D/g, ''))}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 54,
            margin: '16px 0',
            fontSize: 28,
            letterSpacing: 10,
            border: `2px solid ${C.border}`,
            borderRadius: 12,
            padding: 12,
          }}
        />
        {error && <p role="alert">{error}</p>}
        <button
          disabled={busy}
          type="submit"
          style={{
            minHeight: 48,
            width: '100%',
            background: C.primary,
            color: C.text,
            border: `2px solid ${C.border}`,
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 800,
          }}
        >
          {busy ? '验证中… / Verifying…' : '进入工作台 / Enter workspace'}
        </button>
        <a href={cancelHref} style={{ display: 'block', marginTop: 24, color: C.text }}>
          返回 / Back
        </a>
      </form>
    </main>
  );
}
