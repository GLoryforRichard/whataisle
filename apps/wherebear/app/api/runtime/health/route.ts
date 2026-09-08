import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runtimeDirectory } from '@/lib/runtime-paths.mjs';
import { isManagedStore } from '@/lib/store-runtime';
import { getStoreRuntime, runtimeDenied } from '@/lib/store-runtime';
import { getDb } from '@/lib/mongodb';
import { STORE_ID } from '@/lib/store-identity.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await getStoreRuntime();
    if (isManagedStore()) await Promise.all(['SCAN_JOBS_DIR','MDB_MCP_LOG_PATH'].map(variable=>access(runtimeDirectory(variable as 'SCAN_JOBS_DIR'|'MDB_MCP_LOG_PATH'),constants.W_OK)));

    await (await getDb()).command({ ping: 1 });
    return Response.json(
      { ok: true, storeId: STORE_ID, status: 'ready' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return runtimeDenied(503, 'Store not ready', { storeId: STORE_ID });
  }
}
