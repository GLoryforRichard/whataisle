# WhereBear integration — release record

Date: 2026-09-05. Source: WhereBear commit
`aff88a006459233ca101697c78f0a5c282c48ad3`.

## Boundary and authoritative source

WhatAisle is the maintained repository for both applications:

- Root: existing marketing, account, billing, and administrator application.
- `apps/wherebear`: complete existing store application, independent npm lockfile
  and build. It runs on the existing WhereBear VM. The website still deploys to
  its existing Cloud Run service through `deploy.yml` on pushes to `main`.
- `stores/registry.json`: versioned platform store registry. WhereBear is customer
  1, stable ID/handle `wherebear`, platform-managed until an actual owner account
  is explicitly assigned. This does not create a fictitious payment or customer
  account. `/admin/stores` lists it for real administrator sessions only.

The earlier MVP review and ten-store plan describe the pre-integration split.
Existing root `store` tables are dormant; this integration does not resurrect
old product routes or copy Mongo documents into incompatible Postgres tables.

## Data ownership

Every store is a deployment-bound data boundary. WhereBear retains:

| Data | Existing source of truth |
| --- | --- |
| Products, names, aliases, locations, thumbnails | Atlas `wherebear.products` |
| Shelf evidence | `wherebear.shelf_evidence` |
| Current and legacy searches | `wherebear.search_history`, `search_logs` |
| Usage/cost events | `wherebear.op_events` |
| Durable server job status | `wherebear.scan_jobs` |
| Server photos and pending results | Existing `SCAN_JOBS_DIR`, default `/tmp/wherebear-scan-jobs` on the same VM |
| Phone photos not yet fully saved | Each legacy origin's `wherebear-scan` IndexedDB |
| Shelf/map definition | Existing `apps/wherebear/lib/shelves.ts` and map components |
| Account/subscription information | Existing WhatAisle Postgres database |

No database rename, import, re-embedding, bulk update, or product deletion is
part of the cutover. The existing `vector_index` uses Voyage autoEmbed; replacing
it with the old WhatAisle Qwen/pgvector representation would change retrieval.
A future store must have its own database AND credentials limited to that
store, own queue directory, map, VM/runtime binding, and registry identity.
Never clone WhereBear credentials for another customer's deployment. This
release registers only WhereBear; it is not a self-service store provisioner.

Baseline, read-only verification: 14,482 products; 175 shelf evidence records;
1,579 current search records; 39 legacy search records; zero scan jobs.
`text_index` and `vector_index` were READY/queryable. These are a snapshot, not
fixed expected counts once normal customer traffic resumes.

## Domain transition

DNS change at Spaceship: add **A `wherebear` → `34.130.157.162`** for
`whataisle.com`. Preserve root, www, wildcard, MX, TXT, and certificate-validation
records. This specific record overrides the wildcard that currently lands on
the marketing load balancer. Preserve any existing specific record for rollback;
verify there is no conflicting AAAA or CNAME on the new name.

Caddy continues serving the old apex and www domains from the existing VM and
adds the new canonical host. No NameSilo DNS change is necessary. Keep legacy
HTTPS certificates renewed; printed QR codes and dormant phones still use them.

Activate `WHEREBEAR_DOMAIN_CUTOVER=1` only after new-domain HTTPS and identity
checks pass. Non-HTML page requests get a path/query-preserving 308. Browser
visits first drain any local photo queue, then `location.replace` keeps the
path, query, and fragment at the new domain. Pending or failed photos prevent
redirection; staff can finish/retry/remove them in the old queue. The migration
code does not delete local records. Old same-origin APIs remain available to
already-open pages so SSE and uploads do not break on cross-origin redirects.
Camera/microphone permissions and the existing sessionStorage staff unlock may
need to be granted again at the new origin; they cannot be copied by DNS.

## Deployment and rollback

1. Run both app builds and type checks, root lint/unit tests, store unit tests,
   and `pnpm exec playwright test --config playwright.wherebear.config.ts`.
2. Prepare a new release directory on `wherebear-vm`. Transfer only tracked
   `apps/wherebear` sources; never transfer `.env`, `.next`, or local dependencies.
   Symlink the VM's existing `.env.local`, then run npm ci/test/typecheck/build.
3. Start preview on loopback port 3001 with
   `WHEREBEAR_BACKGROUND_DISABLED=1` and cutover disabled. The existing single
   worker on this SAME VM still owns its queue. Read-only smoke test identity,
   counts, map, history, and a real search before changing traffic.
4. Back up Caddy config, process configuration, and database before activation.
   Preserve old `.next/static` chunks for already-open browser tabs. Temporarily
   pause new scan intake with a retryable 429 while draining active server jobs;
   verify zero queued/running jobs before stopping the old worker.
5. Switch Caddy to the prepared app. Stop the old worker before enabling the new
   one. Verify the new worker and health, then remove the temporary intake pause.
6. Verify new-domain TLS, identity, search, voice/photo input, staff entry, map,
   and old-domain paths before enabling the cutover flag. Keep the source checkout
   and old process definition available for rollback.

Rollback: disable the cutover flag; restart the preserved original process only
AFTER stopping the new worker, restore the backed-up Caddy routing, and verify
counts/search. Both use the same unchanged database and on-VM queue files, so no
reverse data migration is required. Restore/remove only the exact new DNS record
if domain rollback is necessary. Do not delete old source or customer records.

## Validation limits

Both production builds and unit suites are required. Browser domain tests use
mocked APIs and a synthetic local photo, so they validate routing/queue safety,
not real Gemini accuracy. Production verification must be recorded separately;
a successful build is not proof of all real AI or mobile-device behavior.
