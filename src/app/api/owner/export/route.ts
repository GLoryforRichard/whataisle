import { getDb } from '@/db';
import {
  floorMap,
  product,
  productAlias,
  productLocation,
  shelf,
} from '@/db/store.schema';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { getBuffer } from '@/storage/local-store';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { NextResponse } from 'next/server';

export const maxDuration = 120;

/**
 * Self-service data export (requirements §7: "the store memory belongs to the
 * store"; unlimited and free). Produces a zip with the product/alias/location
 * table (CSV), the floor map (JSON), and product thumbnail images.
 */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const store = await requireOwnerStore();
  if (!store) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const db = await getDb();
  const [products, aliases, locations, shelves, map] = await Promise.all([
    db.select().from(product).where(eq(product.storeId, store.id)),
    db.select().from(productAlias).where(eq(productAlias.storeId, store.id)),
    db
      .select({
        productId: productLocation.productId,
        shelfCode: shelf.code,
        side: productLocation.side,
        seenCount: productLocation.seenCount,
      })
      .from(productLocation)
      .innerJoin(shelf, eq(productLocation.shelfId, shelf.id))
      .where(
        and(
          eq(productLocation.storeId, store.id),
          eq(productLocation.status, 'active')
        )
      ),
    db.select().from(shelf).where(eq(shelf.storeId, store.id)),
    db.select().from(floorMap).where(eq(floorMap.storeId, store.id)).limit(1),
  ]);

  const aliasesByProduct = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = aliasesByProduct.get(a.productId) ?? [];
    arr.push(a.alias);
    aliasesByProduct.set(a.productId, arr);
  }
  const locsByProduct = new Map<string, typeof locations>();
  for (const l of locations) {
    const arr = locsByProduct.get(l.productId) ?? [];
    arr.push(l);
    locsByProduct.set(l.productId, arr);
  }

  const zip = new JSZip();

  // products.csv
  const header = [
    'canonical_name',
    'name_zh',
    'category',
    'aliases',
    'shelves',
    'evidence_count',
  ];
  const rows = products
    .filter((p) => p.status !== 'deleted')
    .map((p) =>
      [
        p.canonicalName,
        p.nameZh,
        p.category,
        (aliasesByProduct.get(p.id) ?? []).join('; '),
        (locsByProduct.get(p.id) ?? [])
          .map((l) => (l.side ? `${l.shelfCode}${l.side}` : l.shelfCode))
          .join('; '),
        p.evidenceCount,
      ]
        .map(csvCell)
        .join(',')
    );
  zip.file('products.csv', [header.join(','), ...rows].join('\n'));

  // shelves.csv
  zip.file(
    'shelves.csv',
    [
      'code,label',
      ...shelves
        .filter((s) => s.status !== 'deleted')
        .map((s) => `${csvCell(s.code)},${csvCell(s.label)}`),
    ].join('\n')
  );

  // floor-map.json
  if (map[0]?.mapJson) {
    zip.file('floor-map.json', JSON.stringify(map[0].mapJson, null, 2));
  }

  // thumbnails/
  const thumbs = zip.folder('thumbnails');
  for (const p of products) {
    if (!p.thumbnailKey) continue;
    const buf = await getBuffer(p.thumbnailKey);
    if (buf) {
      thumbs?.file(`${p.canonicalName.replace(/[^\w-]+/g, '_')}.jpg`, buf);
    }
  }

  const blob = await zip.generateAsync({ type: 'nodebuffer' });
  return new NextResponse(new Uint8Array(blob), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${store.handle}-export.zip"`,
    },
  });
}
