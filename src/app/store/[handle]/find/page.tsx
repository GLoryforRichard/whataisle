import { ShopperResults } from '@/components/store/shopper-results';
import { getStoreByHandle } from '@/lib/store-context';

interface FindPageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ q?: string }>;
}

/**
 * Shopper results page (§4.1). The query comes from the URL; results stream
 * over SSE in the client component.
 */
export default async function FindPage({
  params,
  searchParams,
}: FindPageProps) {
  const { handle } = await params;
  const { q } = await searchParams;
  const store = await getStoreByHandle(handle);
  if (!store) return null;

  return <ShopperResults query={(q ?? '').slice(0, 120)} />;
}
