-- Custom SQL migration file, put your code below! --

-- A product location with side = NULL ("no left/right distinction") must be
-- unique per (product, shelf). By default Postgres treats NULLs as distinct in
-- unique indexes, so re-scanning the same shelf inserted a duplicate location
-- row instead of bumping seen_count. NULLS NOT DISTINCT fixes this.

-- Collapse any duplicate NULL-side locations created before this fix: keep the
-- row with the highest seen_count, sum the others into it, delete the rest.
WITH ranked AS (
  SELECT id, product_id, shelf_id, seen_count,
         row_number() OVER (
           PARTITION BY product_id, shelf_id
           ORDER BY seen_count DESC, last_seen_at DESC
         ) AS rn,
         sum(seen_count) OVER (PARTITION BY product_id, shelf_id) AS total
  FROM product_location
  WHERE side IS NULL AND status = 'active'
)
UPDATE product_location pl
SET seen_count = ranked.total
FROM ranked
WHERE pl.id = ranked.id AND ranked.rn = 1;
--> statement-breakpoint
DELETE FROM product_location pl
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY product_id, shelf_id
           ORDER BY seen_count DESC, last_seen_at DESC
         ) AS rn
  FROM product_location
  WHERE side IS NULL AND status = 'active'
) dups
WHERE pl.id = dups.id AND dups.rn > 1;
--> statement-breakpoint
DROP INDEX IF EXISTS product_location_unique_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX product_location_unique_idx
  ON product_location (product_id, shelf_id, side) NULLS NOT DISTINCT;
