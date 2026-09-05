'use client';

import { useEffect, useState } from 'react';
import { outboxListAll } from '@/lib/scan-queue/outbox';
import { CANONICAL_URL, LEGACY_HOSTS } from '@/lib/store-identity.mjs';
import { restoreFromOutbox } from '@/lib/scan-queue/pump';

/**
 * Restores the global scan queue from IndexedDB once per app load, so a
 * reload / tab close / iOS process kill resumes in place. Mounted app-wide
 * in the root layout. Restore never auto-reloads the page (StaleClientGuard
 * lesson: a reload kills in-flight uploads) — it resumes where things stood.
 */
export default function QueueBoot() {
  const [pendingMove, setPendingMove] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (!LEGACY_HOSTS.includes(window.location.hostname)) {
      void restoreFromOutbox();
      return;
    }
    let stopped = false;
    // Keep the old origin until every local photo is saved. Origin-scoped
    // IndexedDB cannot be carried through an HTTP redirect. Never clear it.
    const check = async () => {
      try {
        const migration = await fetch('/api/domain-migration', { cache: 'no-store' }).then(r => r.json());
        if (!migration.enabled) {
          void restoreFromOutbox();
          return;
        }
        const pending = (await outboxListAll()).filter(row => row.status !== 'saved');
        if (stopped) return;
        if (pending.length) {
          setPendingMove(true);
          void restoreFromOutbox();
          return;
        }
        const destination = new URL(CANONICAL_URL);
        destination.pathname = window.location.pathname;
        destination.search = window.location.search;
        destination.hash = window.location.hash;
        window.location.replace(destination.toString());
      } catch {
        // A storage error is not proof that no photos remain. Stay on the
        // original origin so the user can recover them instead of losing access.
        if (!stopped) setStorageError(true);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  if (!pendingMove && !storageError) return null;
  return (
    <aside role="status" style={{ padding: 12, background: 'var(--background, #fff)', color: '#111', borderBottom: '2px solid currentColor', position: 'relative', zIndex: 100 }}>
      {storageError
        ? '暂时无法检查本机照片，请保留此页面。Could not check saved photos; please keep this page open.'
        : '正在完成原网址的照片任务，完成后自动前往新网址。Finishing saved photos before moving to our new address.'}
      {' '}<a href="/admin/queue">查看待处理照片 / View pending photos</a>
    </aside>
  );
}
