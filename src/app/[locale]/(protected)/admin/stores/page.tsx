import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { StoreCleanupPanel } from '@/components/store/store-cleanup-panel';
import { getManagedStoreStatus, managedStores } from '@/data/managed-stores';
import { getSession } from '@/lib/server';
import { Routes } from '@/routes';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

export default async function ManagedStoresPage() {
  const session = await getSession();
  if (session?.user?.role !== 'admin') redirect(Routes.Dashboard);
  const zh = (await getLocale()) === 'zh';
  const title = zh ? '门店管理' : 'Stores';
  const stores = await Promise.all(
    managedStores.map(async (store) => ({
      ...store,
      health: await getManagedStoreStatus(store),
    }))
  );
  return (
    <>
      <DashboardHeader breadcrumbs={[{ label: title, isCurrentPage: true }]} />
      <div className="space-y-6 px-4 py-6 lg:px-6">
        <div>
          <h1 className="font-bold text-2xl">{title}</h1>
          <p className="mt-2 text-muted-foreground">
            {zh
              ? '每家超市有自己的网址、商品和货架。门店之间不共享商品数据。'
              : 'Each store has its own address, products and shelves. Product data stays separate.'}
          </p>
        </div>
        {stores.map((store) => (
          <section
            key={store.id}
            className="space-y-5 rounded-xl border bg-card p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-sm">
                  {zh ? '客户' : 'Customer'} #{store.customerNumber}
                </p>
                <h2 className="font-bold text-xl">{store.name}</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  {store.url}
                </p>
              </div>
              <span className="rounded-full border px-3 py-1 text-sm">
                {store.health
                  ? zh
                    ? '已连接'
                    : 'Connected'
                  : zh
                    ? '新网址尚未连接，请检查域名或服务'
                    : 'New address unavailable; check domain or service'}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-sm">
                  {zh ? '商品' : 'Products'}
                </p>
                <p className="font-semibold text-xl">
                  {store.health?.products.toLocaleString() ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">
                  {zh ? '数据归属' : 'Data ownership'}
                </p>
                <p>{zh ? '本店独立保存' : 'Separate store database'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">
                  {zh ? '管理方式' : 'Managed by'}
                </p>
                <p>{zh ? '平台协助管理' : 'WhatAisle operations'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                ['', zh ? '顾客找货' : 'Shopper search'],
                ['/admin', zh ? '扫货与货架管理' : 'Scanning and shelves'],
                ['/admin/queue', zh ? '扫描队列' : 'Scan queue'],
                ['/dashboard', zh ? '使用统计' : 'Usage'],
                ['/searchlog', zh ? '搜索记录' : 'Search history'],
              ].map(([path, label]) => (
                <a
                  key={path}
                  href={`${store.url}${path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border-2 px-4 py-2 font-medium hover:bg-accent"
                >
                  {label}
                </a>
              ))}
            </div>
          </section>
        ))}
        <StoreCleanupPanel />
      </div>
    </>
  );
}
