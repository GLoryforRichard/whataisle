import { PosterSheet } from '@/components/manage/poster-sheet';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import QRCode from 'qrcode';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Print-ready in-store materials (requirements §4.1): poster, checkout-counter
 * stand, and shelf stickers — each with the QR code and plain-text URL. "How
 * shoppers find out they can scan" is the product's job, not the owner's.
 */
export default async function ManagePostersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.posters');

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;
  if (!store) return null;

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
  const url = `https://${store.handle}.${rootDomain}`;
  // QR generated server-side as a data URL (self-contained, printable).
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 600,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="font-bold text-2xl">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('intro')}</p>
      </div>
      <PosterSheet
        storeName={store.displayName}
        url={url}
        qrDataUrl={qrDataUrl}
      />
    </div>
  );
}
