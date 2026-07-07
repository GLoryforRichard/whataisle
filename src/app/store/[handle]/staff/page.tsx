import { StaffPinForm } from '@/components/store/staff-pin-form';
import { getStaffSession } from '@/lib/staff-auth';
import { getStoreByHandle } from '@/lib/store-context';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

interface StaffPageProps {
  params: Promise<{ handle: string }>;
}

/**
 * Staff entry: a store-level PIN, no accounts (requirements §4.2).
 */
export default async function StaffPage({ params }: StaffPageProps) {
  const { handle } = await params;
  const store = await getStoreByHandle(handle);
  if (!store) return null; // layout already rendered the not-found screen

  const session = await getStaffSession(store);
  if (session) {
    redirect('/staff/scan');
  }

  const t = await getTranslations('Store');

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="font-bold text-2xl">{t('staff.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('staff.pinPrompt')}</p>
      </div>
      <StaffPinForm />
      <p className="text-center text-muted-foreground text-sm">
        {t('staff.pinHint')}
      </p>
    </div>
  );
}
