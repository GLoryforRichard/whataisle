/**
 * Seed script for local development.
 *
 * Usage: pnpm seed
 *
 * Creates demo data so every surface has something to render:
 * - two owner accounts with stores `demo` and `mart2` (for tenant-isolation testing)
 * - shelves for each store
 *
 * Later phases extend this with products, aliases, locations, and a floor map.
 * Idempotent: safe to run repeatedly.
 */
import 'dotenv/config';

async function main() {
  const { getDb } = await import('../src/db');
  const db = await getDb();

  // Phase 1 will add: stores, shelves, staff PINs.
  // Phase 2 will add: products, aliases, locations, scan evidence.
  console.log('seed: connected to database');
  console.log('seed: nothing to do yet (store schema lands in Phase 1)');
  void db;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
