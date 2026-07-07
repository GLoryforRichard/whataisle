import { ShelfManager } from '@/components/manage/shelf-manager';
import { productRepo } from '@/data/product-repo';
import { tenantRepo } from '@/data/tenant-repo';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Shelf & product management (requirements §4.2): browse products by shelf,
 * add shelves, delete products, clear a shelf (owner-only + confirm).
 */
export default async function ManageShelvesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.shelves');

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;
  if (!store) return null;

  const shelves = await tenantRepo(store.id).listShelves();
  const repo = productRepo(store.id);
  const withProducts = await Promise.all(
    shelves.map(async (s) => {
      const rows = await repo.listByShelf(s.id);
      return {
        id: s.id,
        code: s.code,
        label: s.label,
        products: rows.map((r) => ({
          id: r.product.id,
          name: r.product.canonicalName,
          nameZh: r.product.nameZh,
        })),
      };
    })
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <ShelfManager shelves={withProducts} />
    </div>
  );
}
