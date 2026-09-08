'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FloorMap } from '@/lib/floor-map-model.mjs';
import { SHELVES } from '@/lib/shelves';
import { C, FONT } from '@/lib/theme';
export interface PublicStoreRuntime {
  ok: true;
  storeId: string;
  displayName: string;
  managed: boolean;
  accessAllowed: boolean;
  setupAllowed: boolean;
  recoveryUrl: string;
  pinLength: number;
  staffAuthorized: boolean;
  ownerAuthorized: boolean;
  map: FloorMap | null;
}
const StoreContext = createContext<{
  store: PublicStoreRuntime;
  refresh: () => Promise<void>;
} | null>(null);
export function useStoreRuntime() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('Store runtime not loaded');
  return value;
}
export function useShelfCatalog() {
  const { store } = useStoreRuntime();
  return useMemo(() => {
    const shelves = store.managed
      ? store.map?.shelves.map((s) => ({
          code: s.id,
          label: s.code,
          description: s.description,
          categories: [],
        })) || []
      : SHELVES.map((s) => ({ ...s, label: s.code }));
    const byId = new Map(shelves.map((s) => [s.code, s]));
    const labelFor = (id: string) => byId.get(id)?.label || id;
    const labelText = (text: string) => text.replace(/s_[a-f0-9]{16}/g, labelFor);
    return { shelves, getShelf: (id: string) => byId.get(id), labelFor, labelText };
  }, [store]);
}
export default function StoreRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<PublicStoreRuntime | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/runtime/config', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Store unavailable');
      setStore(data);
      setError('');
    } catch {
      setError('暂时无法连接商店，请稍后重试。 / Unable to connect to this store.');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  if (error || !store)
    return (
      <main
        style={{
          minHeight: '100dvh',
          background: C.bg,
          padding: 40,
          fontFamily: FONT,
          color: C.text,
        }}
      >
        <p role="status">{error || '正在打开商店… / Opening store…'}</p>
        {error && <button onClick={() => void refresh()}>重试 / Retry</button>}
      </main>
    );
  if (!store.accessAllowed)
    return (
      <main
        style={{
          minHeight: '100dvh',
          background: C.bg,
          padding: 40,
          fontFamily: FONT,
          color: C.text,
        }}
      >
        <h1>{store.displayName}</h1>
        <p>商店服务已暂停。 / Store service is currently paused.</p>
        <a href={store.recoveryUrl}>店主续费恢复 / Owner: restore subscription</a>
      </main>
    );
  return <StoreContext.Provider value={{ store, refresh }}>{children}</StoreContext.Provider>;
}
