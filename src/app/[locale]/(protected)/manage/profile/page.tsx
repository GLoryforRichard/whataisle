import {
  StaffPinForm,
  StoreProfileForm,
} from '@/components/manage/store-settings-form';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function ManageProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [tp, tpin] = await Promise.all([
    getTranslations('Manage.profile'),
    getTranslations('Manage.pin'),
  ]);

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;
  if (!store) return null;

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-8">
      <section className="flex flex-col gap-4">
        <h1 className="font-bold text-2xl">{tp('title')}</h1>
        <StoreProfileForm
          handle={store.handle}
          rootDomain={rootDomain}
          displayName={store.displayName}
          displayNameZh={store.displayNameZh}
          announcement={store.announcement}
          announcementZh={store.announcementZh}
        />
      </section>

      <section className="flex flex-col gap-4 border-t pt-8">
        <h2 className="font-bold text-xl">{tpin('title')}</h2>
        <StaffPinForm />
      </section>
    </div>
  );
}
