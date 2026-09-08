import { NextRequest } from 'next/server';
import { authorizeStoreRequest } from '@/lib/store-runtime';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { mergeActivity } from '@/lib/activity.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVITY_LIMIT = 30;
const SOURCE_LIMIT = ACTIVITY_LIMIT * 2;

export async function GET(req: NextRequest) {
  const storeDenied = await authorizeStoreRequest(req);
  if (storeDenied) return storeDenied;
  try {
    const db = await getDb();
    const [snaps, searchHistory, legacySearchLogs] = await Promise.all([
      db.collection('shelf_evidence')
        .find({})
        .sort({ timestamp: -1 })
        .limit(SOURCE_LIMIT)
        .toArray(),
      db.collection('search_history')
        .find({})
        .sort({ ts: -1 })
        .limit(SOURCE_LIMIT)
        .toArray(),
      db.collection('search_logs')
        .find({})
        .sort({ timestamp: -1 })
        .limit(SOURCE_LIMIT)
        .toArray(),
    ]);

    const items = mergeActivity(snaps, searchHistory, legacySearchLogs, ACTIVITY_LIMIT);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
