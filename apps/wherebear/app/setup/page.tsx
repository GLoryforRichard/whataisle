'use client';
import { useEffect, useRef, useState } from 'react';
import { useStoreRuntime } from '@/components/StoreRuntimeProvider';
import FloorMapEditor from '@/components/FloorMapEditor';
export default function SetupPage() {
  const { store, refresh } = useStoreRuntime();
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => {
    const token = new URL(window.location.href).searchParams.get('owner_token');
    if (!token || started.current) return;
    started.current = true;
    window.history.replaceState(null, '', '/setup');
    void fetch('/api/runtime/owner-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        await refresh();
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  if (error)
    return (
      <main style={{ padding: 40 }}>
        <p role="alert">{error}</p>
        <a href={store.recoveryUrl}>返回店主账户 / Owner dashboard</a>
      </main>
    );
  if (store.map && !store.ownerAuthorized)
    return (
      <main style={{ padding: 40 }}>
        <p>请从店主账户打开平面图编辑器。 / Open the editor from your owner dashboard.</p>
        <a href="/">返回商店 / Store home</a>
      </main>
    );
  if (!store.managed) return <main style={{ padding: 40 }}>This store uses its existing map.</main>;
  return <FloorMapEditor owner={Boolean(store.map)} />;
}
