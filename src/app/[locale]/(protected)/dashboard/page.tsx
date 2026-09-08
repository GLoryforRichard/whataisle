import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { OwnerStorePanel } from '@/components/store/owner-store-panel';
import { StoreSubscriptionCard } from '@/components/store/store-subscription-card';
import { getLocale } from 'next-intl/server';

export default async function DashboardPage() {
  const zh = (await getLocale()) === 'zh';
  const title = zh ? '我的门店' : 'My store';
  return (
    <>
      <DashboardHeader breadcrumbs={[{ label: title, isCurrentPage: true }]} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 lg:px-6">
        <h1 className="font-bold text-2xl">{title}</h1>
        <OwnerStorePanel />
        <StoreSubscriptionCard />
      </div>
    </>
  );
}
