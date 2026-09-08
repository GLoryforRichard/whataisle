# Store tablet browser acceptance

Executed against the onboarding candidate on **2026-09-08 UTC: seven checks
passed**. Earlier manual snapshots established confirmation, the shelf picker
and public home; this repeatable run additionally establishes touch gestures,
draft recovery and real browser upload acceptance. It complements the 19
HTTP/Mongo checks.

`scripts/store-browser-integration.mts` runs Chromium at 1024×768 with touch
enabled, the existing production store build, a new loopback Mongo process and
a fixture platform access/owner-grant API. It never starts the platform or uses
its PostgreSQL, Stripe, Atlas, email or external AI services. No store business
API is mocked. AI workers stay disabled; successful upload means acceptance into
the real store queue, not recognition or paid search success.

The journey must demonstrate:

1. An empty public tablet canvas; touch drawing two shelves, moving one, editing
   label/description/width/height, and recovering the exact draft after reload.
2. Wrong PIN keeps the Mongo map absent; correct PIN publishes the same shelf
   IDs, opens staff scanning and makes the public URL show Find item immediately.
3. A separate browser context cannot enter staff tools without the PIN. It
   chooses a newly drawn shelf and uploads a generated local photo through the
   actual file input; the real Mongo queue and per-store disk receive it.
4. A one-use fixture owner link reopens the actual editor. Moving/renaming a
   published shelf preserves its ID, seeded product association and queued
   photo association, and the shelf picker displays its updated name.

Only after the main task schedules this isolated run, from the candidate root:

```sh
node --import tsx scripts/store-browser-integration.mts --run
```

The script requires an already-built `apps/wherebear/.next`, installed Chromium
and local `mongod` (`MONGOD_BINARY` may select another installed binary). It does
not build, install dependencies or reuse existing servers. Plain invocation or
`--review` prints the plan without starting anything. It rejects app environment
files and starts child processes from an explicit non-secret environment.

Reports/screenshots go to a unique private directory under `output/playwright/`.
All browser contexts, fixture HTTP service and child processes are closed in
`finally`; only this run's temporary Mongo/data directories are removed. Failure
retains screenshots and bounded process logs for review. A passed report proves
Chromium touch emulation, not physical iPad Safari or real camera/AI operation.

## Recorded candidate result

- Final run: `output/playwright/store-tablet-yx53YJ/report.json`, seven passed,
  zero uncaught browser errors and zero external/paid API attempts; process exit
  `0`. No fixture Mongo process or active temporary fixture directory remains.
- Screenshots `02-drawn-and-moved.png` and `04-wrong-pin.png` were visually
  inspected at 1024×768. They show two drawn shelves, the complete footer and
  clearly bounded label, description, width/height and password inputs.
- Browser file selection produced a real `202` response, one Mongo `scan_jobs`
  record and a nonempty per-store photo file. AI remained disabled. Owner edits
  preserved both the seeded product's shelf association and that queued photo's
  association; the staff picker showed the renamed shelf.
- Visual inspection found previously invisible input boundaries. The candidate
  and original workspace received only the corresponding `FloorMapEditor`
  input-style changes. The final store build and typecheck passed before this
  seven-check rerun; no business API or authorization rule was changed.
- Logs: `/tmp/whataisle-release-tablet-store-build-final.log`,
  `/tmp/whataisle-release-tablet-store-typecheck-final.log`, and
  `/tmp/whataisle-release-tablet-ui-final2.log`. Screenshots/reports are local,
  ignored artifacts, not production data or release payloads.
