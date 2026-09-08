'use client';
import Link from 'next/link';
import { useStoreRuntime } from './StoreRuntimeProvider';
import { C, FONT, SHADOW } from '@/lib/theme';

export default function StorePreparing({ staff = false }: { staff?: boolean }) {
  const { store } = useStoreRuntime();
  return (
    <main style={{ minHeight: '100dvh', padding: 'clamp(20px, 5vw, 48px)', display: 'grid', placeItems: 'center', background: C.bg, color: C.text, fontFamily: FONT }}>
      <section style={{ width: '100%', maxWidth: 600, padding: 'clamp(24px, 4vw, 40px)', border: `2px solid ${C.border}`, borderRadius: 24, background: C.white, boxShadow: SHADOW }}>
      <h1 style={{ fontSize: 28, lineHeight: 1.25, fontWeight: 800, margin: '0 0 24px', overflowWrap: 'anywhere' }}>{store.displayName}</h1>
      <h2 style={{ fontSize: 21, lineHeight: 1.4, fontWeight: 800, margin: '0 0 16px' }}>门店正在准备 / Store preparation in progress</h2>
      <p role="status" style={{ fontSize: 17, lineHeight: 1.65, margin: '0 0 28px', color: C.textMuted }}>
        {staff
          ? store.map
            ? '地图已保存，照片上传暂未开放。准备好后，此页会自动开放。 / Your map is saved. Photo upload will open here automatically when preparation is complete.'
            : '请先确认货架平面图，再等待开放照片上传。 / Confirm the shelf layout before photo upload opens.'
          : '我们正在准备商品查找服务，请稍后再来。 / Product search will be available when store preparation is complete.'}
      </p>
      <Link href={staff ? '/' : '/admin'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '12px 20px', border: `2px solid ${C.border}`, borderRadius: 12, background: C.primarySoft, color: C.text, fontSize: 16, lineHeight: 1.4, fontWeight: 800, textDecoration: 'none' }}>
        {staff ? '返回商店 / Store home' : '员工工作台 / Staff workspace'}
      </Link>
      </section>
    </main>
  );
}
