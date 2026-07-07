import { ShopperResults } from '@/components/store/shopper-results';
import { tenantRepo } from '@/data/tenant-repo';
import type { FloorMapJson } from '@/db/store.schema';
import { getStoreByHandle } from '@/lib/store-context';

interface FindPageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ q?: string }>;
}

/**
 * Shopper results page (§4.1). The query comes from the URL; results stream
 * over SSE in the client component. The published floor map (if any) is loaded
 * here so results can highlight the target shelf in red.
 */
export default async function FindPage({
  params,
  searchParams,
}: FindPageProps) {
  const { handle } = await params;
  const { q } = await searchParams;
  const store = await getStoreByHandle(handle);
  if (!store) return null;

  const map = await tenantRepo(store.id).getFloorMap();
  const mapJson: FloorMapJson | null =
    map && map.status === 'published' ? (map.mapJson ?? null) : null;

  return <ShopperResults query={(q ?? '').slice(0, 120)} mapJson={mapJson} />;
}
