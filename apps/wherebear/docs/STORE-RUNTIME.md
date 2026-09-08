# Store runtime contract

The same production build runs once per store. Client bundles do not select a
store or contain store credentials. Public identity and map data come from
`GET /api/runtime/config`. The process environment owns the database identity.

Required for a newly provisioned store:

- `STORE_ID`: exact platform store ID.
- `STORE_CANONICAL_URL`: `https://<handle>.whataisle.com`.
- `WHATAISLE_PLATFORM_URL`: trusted platform origin (HTTPS; loopback HTTP allowed).
- `STORE_RUNTIME_TOKEN`: random secret of at least 32 characters. The platform
  stores its hash; never return this token to a browser.
- `MONGODB_URI` and `MONGODB_DB`: restricted credentials for this store only.
- `SCAN_JOBS_DIR`: private directory for this store's accepted photos/results.
- `MDB_MCP_LOG_PATH`: absolute, writable per-store subprocess log directory.
  Neither scan files nor MCP logs may use the shared release's current
  directory. Health checks verify both directories are writable before
  provisioning publishes a route.
- `STORE_SESSION_SECRET`: optional independent random secret; otherwise the
  runtime token signs sessions with a dedicated domain-separated HMAC.

Missing configuration, mismatched store identity/handle, or unavailable platform
state fails closed. No process falls back to another store's map or database.
The no-environment legacy identity is customer 1, WhereBear, with its existing
map. Before deploying this release to that legacy process configure a server-only
`STAFF_PIN_HASH` (six-digit PIN) and `STAFF_SESSION_SECRET`. There is no
JavaScript-embedded staff password or dependency on a separate deletion PIN.

## Platform API

All requests use `Authorization: Bearer <STORE_RUNTIME_TOKEN>`, `cache: no-store`,
and the deployment's fixed store ID. The platform supplies:

`GET /api/runtime/store/<storeId>`

```
{storeId,handle,displayName,pinHash,pinVersion,accessAllowed,setupAllowed,searchReady,
 serviceEndsAt,recoveryUrl}
```

PIN encoding is `scrypt$<32-character salt hex>$<128-character derived-key hex>`.
Node's default scrypt parameters derive 64 bytes from the six-digit string and
the salt's hexadecimal text. Changing the PIN must increment `pinVersion`.
That immediately invalidates both staff and owner map sessions on every device.

`POST /api/runtime/store/<storeId>/owner-entry` accepts `{token}`. The platform
atomically consumes a short-lived, owner-authorized one-time grant, returning
`{allowed:true,pinVersion}`. Dashboard links use `/setup?owner_token=<grant>`.
The client removes the token from the address before exchanging it; documents
use a `no-referrer` policy. The exchange creates a 30-minute HttpOnly map session.

`GET /api/runtime/health` checks the configuration and Mongo connection and returns
only `{ok,storeId,status:'ready',searchReady}`. It does not return database names/counts or
credentials. Provisioning should check this before installing the public route.
`searchReady: false` does not make this infrastructure check fail: drawing and
map persistence must work before the founder activates photo/search services.

## Opening and maps

Before confirmation, the root URL shows the full-screen tablet editor. Drafts
live only in that origin's browser local storage. The first confirmation submits
the map and a fresh PIN; an atomic insert saves the map and issues a staff
session. Until activation, the root URL shows preparation status and the
authenticated workspace says the map is saved but photo upload is not open.
The owner can still edit through a one-time owner entry. If already activated,
confirmation redirects to `/admin?opened=1` as before.

The platform returns `searchReady: true` only after the restricted provisioning
worker verifies both Search indexes and completes its activation lease. Missing
or non-boolean readiness is treated as false for managed stores; legacy
WhereBear keeps its existing behavior. Billing access is a separate condition.
Configuration refreshes every ten seconds, so a waiting page opens operations
without recreating maps or shelf IDs. Runtime startup, PIN verification and map
writes never wait for Search. A later externally removed index is not detected
by this activation flag; withdrawal/reactivation must be recorded by the platform.

The `store_floor_map` collection has a single `published` document with a
monotonic revision and embedded shelf objects `{id,code,description,x,y,w,h}`.
The stable `id` is the scan/product location key. `code` is only a display label.
Moving or relabeling never rewrites product locations. Existing shelves cannot be
removed through this initial editor, preventing silently orphaned locations.
Only the owner grant authorizes subsequent map edits; staff sessions and PINs
alone cannot edit a published map. Revision checks reject concurrent stale saves.

Every operational API route calls `authorizeStoreRequest` before work. Upload,
scan result, save, operational data, and admin mutation APIs require staff
sessions. Browser writes also require the store's own origin. Public search,
voice, and photo identification require active service, a confirmed map, and
completed activation. All other operational routes require the same activation
after verifying a staff session. This includes synchronous/async photo intake,
job reads/acknowledgements, product writes and scan-result saves. The scan worker
does not claim jobs while preparation is pending, and the browser queue retains
local photos without automatic submission/deletion until activation and login.
The map endpoint has its dedicated initial-PIN/owner-session guard. Existing
legacy admin product mutations retain their separate `ADMIN_WRITES` lock in
addition to the staff session. Failed PIN guesses have a persistent store-wide
limit; spoofed forwarded IP headers do not increase the allowance.

Suspension blocks new shopper AI requests and staff scanning, retains the owner
recovery link, and stops the worker from claiming fresh paid recognition work.
Already accepted in-flight work may finish. Store data is left intact; the
platform controls retention and founder-confirmed cleanup.

## Verification

`npm run typecheck`, `npm test`, `WHEREBEAR_BACKGROUND_DISABLED=1 npm run build`.
`npm run test:runtime-integration` starts two copies of the built app, a fresh
loopback Mongo process using an installed `mongod`, and a fixture platform API.
Use `MONGOD_BINARY` when the binary differs from `/opt/homebrew/bin/mongod`.
It verifies separate hosts/databases/cookies, empty onboarding, PIN confirmation
while activation is pending, denied photo/search requests before activation,
scan acceptance after the fixture platform enables operations, stable shelf IDs,
owner grants, map revision conflicts, PIN
revocation, suspension, unavailable configuration, and guessing limits. AI workers
are explicitly disabled, so this does not claim recognition/provider coverage.
The fixture uses a unique temporary directory; it stops only its own processes.
`KEEP_RUNTIME_FIXTURE=1` keeps these fixtures running for a browser walkthrough.

From the repository root, `node --env-file=.env --import tsx
scripts/combined-runtime-integration.mts` additionally exercises the actual
platform and store processes against the existing local PostgreSQL on port 5433
and a disposable local Mongo database. It verifies one-time owner entry, the
shared scrypt format, PIN/session revocation, and subscription suspension and
restoration. Subscription state is a synthetic local fixture, not a Stripe
provider call. Only the generated fixture owner/store records are removed.

The worker tick tests defer both the platform check and job claiming to verify
overlapping timer callbacks cannot exceed the configured scan concurrency or
claim photos before activation. Activation guard tests execute the real guard
against platform responses; queue tests preserve offline bytes through a pause
and resume without resubmitting an already confirmed save.

Mongo search still requires the same `$vectorSearch`/`$search` capabilities and
indexes as WhereBear. The separate activation job must verify those capabilities;
a Mongo ping alone is readiness for setup, not proof of working product search.

Legacy cost/vision/compare labs and their shared public experiment/sample assets
are unavailable on managed customer hosts. Those legacy APIs additionally reject
managed runtimes even if a lab enable flag was accidentally inherited.

## Release boundary

This candidate extracts only customer-store runtime changes from base `4271722`.
It excludes the separate uncommitted detailed AI-cost ledger, cost dashboard,
permanent product deletion UI/API, tombstone filtering, and related scripts and
tests. Existing base scan/search usage summaries and existing locked admin CRUD
remain unchanged. The original working directory retains all earlier work.
See `STORE-RELEASE-SCOPE.json` for exact copied/extracted paths. Build this
candidate separately; do not replace an existing WhereBear process that may
require those separately reviewed capabilities.
