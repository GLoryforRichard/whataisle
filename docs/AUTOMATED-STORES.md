# Automatic store runtimes on the shared MVP VM

This is the operator/developer reference for the payment → store setup →
provisioning flow. It does **not** record a production installation. The scripts
are prepared in the repository; live acceptance requires the checks below.
The existing WhereBear process, credentials, MongoDB data and legacy hosts are
outside this provisioner's ownership.
See [the reviewed first-install procedure](STORE-BOOTSTRAP-REVIEW.md) for the
observed VM configuration, exact Caddy addition, private input checklist,
candidate/installation tools and rollback boundaries beyond `main` deployment.

## Deployment boundary

Only `wherebear-prod-20260902 / wherebear-vm /
northamerica-northeast2-b` is accepted. Every applying invocation verifies the
instance identity through GCE metadata before loading a platform task or doing
any provisioning. Both retired projects remain disabled. The worker creates no
VM, cluster, DNS record, firewall rule or cloud IAM grant.

The existing `*.whataisle.com` DNS points to the approved shared VM. DNS alone
is insufficient: each newly paid store receives its own process, OS user,
restricted Atlas database user, MongoDB database, runtime secret, session secret,
queue/photo directory, billing journal, MCP logs, Next cache and Caddy host route. Runtime
ports are chosen from `3101–3199`; platform `3000`, candidate `3001` and legacy
WhereBear `3002` are never selected. The maximum is five total stores including
WhereBear, with capacity exhaustion producing a review-required failure rather
than provisioning another paid resource.

New store identities are immutable platform IDs. Paths and database/user names
are deterministic SHA-256-derived keys; neither a hostname nor a submitted path
can select an existing store database. `wherebear`, reserved platform handles,
path separators, control characters and injected domains are refused.

## Platform worker contract

All endpoints use HTTPS and `Authorization: Bearer PROVISIONING_WORKER_TOKEN`.
This global worker secret is distinct from per-store runtime credentials. It
lives in `/etc/whataisle-provisioning/worker.json`, root-owned mode `0600`.
The parent directory is root-owned `0700`.

| POST endpoint below `/api/internal/` | Body | Successful response |
| --- | --- | --- |
| `provisioning/claim` | `{workerId, leaseSeconds: 300}` | `{job: null}` or `{job: {jobId, storeId, handle, kind, leaseToken, leaseExpiresAt}}` |
| `provisioning/heartbeat` | `{jobId, leaseToken}` | `{leaseExpiresAt}` |
| `provisioning/credentials` | `{jobId, leaseToken, runtimeTokenHash, port}` | JSON acknowledgment |
| `provisioning/complete` (provision) | `{jobId, leaseToken, kind: "provision", runtimeTokenHash, port, canonicalUrl, runtimeVersion}` | JSON acknowledgment |
| `provisioning/complete` (archive) | `{jobId, leaseToken, kind: "archive", archivedAt}` | JSON acknowledgment |
| `provisioning/fail` | `{jobId, leaseToken, code, message, retryable}` | JSON acknowledgment |
| `billing/reconcile` | `{}` | JSON acknowledgment |

`kind` defaults to `provision` for older queued jobs. The platform must create
`archive` jobs only after the founder's explicit cleanup confirmation, not just
because the three-month retention deadline passed. Store deletion must retain
the minimal billing/bonus-eligibility record so reopening or switching plans
cannot grant bonus months again.

The credentials step registers the SHA-256 hash **before** starting the runtime.
This avoids a dependency loop: health checks must authenticate to the platform,
and a runtime cannot authenticate before its token hash exists. The raw runtime
token never goes back to the platform. The platform's config endpoint may serve
an authenticated provisioning runtime while still enforcing actual subscription
entitlement for all customer activity.

The database claim must be atomic. Store/runtime rows persist status, attempts,
lease expiry, next attempt, last safe error, port, version and token hash. Only a
current matching lease may heartbeat or finish. Billing callbacks must not
report successful provisioning merely because a job was queued.

## Prepared assets and local checks

- `scripts/store-provisioning-core.mjs`: validated store identity and paths,
  runtime environment, single-database Atlas grants, stage ordering and cleanup.
- `scripts/store-provisioning-adapters.mjs`: restricted filesystem operations,
  Atlas service-account OAuth, MongoDB/search indexes, systemd, Caddy and health.
- `scripts/store-provisioning.mjs`: dry-run, leased worker and billing reconcile.
- `scripts/store-build-release.sh`: secret-free Linux build from a reviewed Git
  commit, using the store application's npm lockfile and its tests/typecheck.
- `scripts/store-prepare-release.sh`: checksum/path-validated extraction on the
  approved VM, without activating or restarting anything.
- `infra/stores/whataisle-store@.service`: isolated store service template.
- `infra/stores/whataisle-stores.slice`: combined new-store memory/CPU ceiling
  that protects capacity for the existing platform and WhereBear processes.
- `infra/stores/whataisle-provisioning.service`: serialized applying worker.
- `infra/stores/whataisle-billing-reconcile.{service,timer}`: five-minute billing
  and retention maintenance, with a separate lock from provisioning.
- `infra/stores/provisioning-config.example.json`: operator configuration shape.

Run from the repository with its approved Node runtime:

```sh
node --test scripts/store-provisioning.test.mjs
bash -n scripts/store-build-release.sh
bash -n scripts/store-prepare-release.sh
node --env-file=.env --conditions=react-server --import tsx scripts/store-onboarding-integration.mts
node scripts/store-mongo-integration.mjs
```

The integration script refuses any nonlocal PostgreSQL target or port other
than the existing development database at `5433`. It uses uniquely named
fixtures, real repository and HTTP route functions, and removes only those
fixtures in `finally`, preserving pre-existing demo stores. It refuses global
queue-claim checks if unrelated pending jobs exist.

The Mongo integration starts a fresh authenticated, loopback-only `mongod`
(`MONGOD_BINARY` may override the existing local binary). It verifies that a
single-database `readWrite` user can create the product identity index but
cannot read another store. Two independent processes then run the actual
`saveShelfDirect` pipeline against 100 identical products on different shelves;
every SKU must remain one document with both shelf sightings. No Atlas or AI
call runs, and no existing Mongo URI is loaded. Disposable local files remain
available for inspection after the test processes stop.

For a local, non-mutating review, create a JSON file containing only
`{"jobId":"review-1","storeId":"review-store-1","handle":"teststore1"}` and run:

```sh
node scripts/store-provisioning.mjs --dry-run --job /absolute/path/review-job.json
```

Dry-run needs no credentials, generates no secrets, contacts no service, creates
no files, and prints only the calculated resource plan. A passing dry-run is not
proof that Atlas, billing, real HTTPS or the shared VM are configured.

## Atlas prerequisites

An operator supplies an Atlas service account authorized to manage database
users in the approved project, its client ID/secret, project ID, existing
cluster name and SRV host. The worker IP must be allowed by the existing Atlas
API/data access policies. The worker does not add broad network access or grant
itself permissions. Missing credentials are a configuration failure, never a
reason to substitute WhereBear's URI.

The OAuth adapter calls `https://cloud.mongodb.com/api/oauth/token` with the
client-credentials flow and uses short-lived bearer access tokens. It creates a
SCRAM database user scoped to one existing cluster with exactly
`readWrite@wa_<store-key>`. An existing user is checked for an exact matching
scope; broader/mismatched grants fail. Unknown existing credentials are not
silently reset. Generated passwords are saved locally before the first API
attempt, so network timeouts do not generate different passwords on retry.

The new database starts empty. The worker creates `products` and a full unique
index on `name_key`, which makes concurrent scans of a newly seen product
converge on one record while retaining all shelf associations. A pre-existing
weaker index or duplicate data fails explicitly; it is never silently rewritten.
The worker also creates a `vector_index`
using automatic embeddings on `search_text` (default `voyage-4`, configurable
within the reviewed model list), and a `text_index` over `canonical_name`,
`aliases`, and `search_text`. It waits for both indexes to be queryable/READY;
index creation, unsupported capability, or insufficient permissions are explicit
failures. No product, shelf, map, index contents, or customer credentials are
copied from WhereBear. Empty index setup does not run a paid search/scan; future
embedding/query usage follows the configured Atlas plan.

References: [Atlas service-account tokens](https://www.mongodb.com/docs/atlas/api/service-accounts/generate-oauth2-token/),
[database user API](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-creategroupdatabaseuser),
[automatic embeddings](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/).

## Build and reviewed installation

Use Ubuntu `22.04` x86_64/glibc `2.35` and isolated Node `24.18.0`.
`store-build-platform.mjs` rejects musl/Alpine, ARM and other distro/ABI targets
before npm runs; the manifest records this boundary and preparation checks it.
Use `scripts/store-build-container.sh FULL_COMMIT NEW_ABSOLUTE_OUTPUT --plan`
to review the preferred local Docker path. Its explicit `--run` mode uses a
pinned official Ubuntu amd64 image, checksum-verified Node, a read-only snapshot
of the selected commit and a dedicated output mount. It passes no host secrets
or original store working directory into the container. Local ARM emulation
still needs a complete Linux build validation. An inactive alternative is in
`infra/stores/store-build.workflow.example.yml`; it is not an enabled CI job.
Do not build on the live `.next` directory and do not copy Mac native
dependencies to the VM. The release build
starts from `git archive FULL_COMMIT`, clears inherited secrets for npm/tests/
build, sets `WHEREBEAR_BACKGROUND_DISABLED=1` and the non-secret construction
placeholder `GOOGLE_CLOUD_PROJECT=build-only-no-network`, runs typecheck, the store tests,
and build. The output is a reusable app tarball with a manifest that declares
runtime identity `server-env-v1` and platform contract `v1`.

Prepare the artifact using its independently trusted SHA-256. Extraction rejects
embedded environment files, special files, hard links, duplicate paths, directory
traversal, and symlink escapes. The prepared root-owned release resides at
`/srv/whataisle-store/releases/<40-character-commit>`; existing release paths are
not overwritten. A failed partial preparation is retained for investigation.

The reviewed installation must establish:

1. A `current` symlink to the reviewed release and root-owned nonwritable release
   parents. This is a deliberate activation step; the prepare script does not
   change a current release or restart any customer process.
2. The three worker modules in root-owned `/opt/whataisle-provisioning/scripts/`,
   and the supplied systemd units in `/etc/systemd/system/`.
3. Root-only worker configuration populated from the example, the matching
   platform `PROVISIONING_WORKER_TOKEN`, and verified provider settings. Runtime
   provider credentials are copied only from the reviewed `commonRuntimeEnv`
   allowlist, never from WhereBear's environment or from a submitted job.
4. A reviewed addition of exactly `import /etc/caddy/whataisle-stores/*.caddy`
   to the existing Caddyfile, preserving all current platform, WhereBear and
   legacy-host rules. Validate the complete merged Caddyfile before reload.
5. Reload systemd; enable/start `whataisle-provisioning.service` and
   `whataisle-billing-reconcile.timer` only after the platform endpoints and
   database migration have been installed and validated.

No committed file includes an API secret, raw runtime token, MongoDB password or
live database URI. Never place the secret JSON, runtime `.env` files or worker
state in release artifacts or Git. Back them up only to approved private
secret/backup storage.

## Runtime and retry behavior

One `flock` serializes provisioning/cleanup on the VM; process exit releases the
lock. Billing maintenance uses a separate lock so a slow Atlas index build
cannot prevent renewal/grace-period reconciliation. The worker refreshes its
five-minute claim every thirty seconds. Lease loss prevents subsequent stages
and completion; expiry lets the platform recover without force-clearing an
unverified live worker.

Root-only `/var/lib/whataisle-provisioning/stores/<key>.json` stores random
credentials, deterministic resource bindings and progress, written atomically
with `fsync`. Retries use the same token/password/port and reconcile each actual
stage; progress markers alone do not prove a still-running process or route.
The worker never automatically rotates an existing token or restarts an already
running scan worker merely to recover a lost completion acknowledgment.

The per-store data parent is root-owned `0751`; each writable child belongs to
that store's OS user with `0700`. This prevents a live store process replacing a
parent directory used by privileged retries. Runtime environment files remain
root-owned `0600` and are read by systemd before dropping privileges. Each
process has a private temporary directory and a separate cache bind mount,
restricted writable directories, no administrative capabilities, bounded memory
and reduced scan concurrency for the shared VM. This is a starting limit,
not a substitute for the required multi-store workload test on the 4-GiB host.

Loopback and public TLS health must return this exact store ID and successful
platform+MongoDB checks. Caddy receives a single generated store fragment only
after local health passes. Invalid fragment/reload failures retain diagnostics
and move a newly introduced fragment aside rather than overwriting a whole
Caddyfile backup. Public health must pass before the platform gets completion.
A failed job remains recoverable in the paid owner's dashboard.

## Founder-confirmed cleanup

Archive jobs first stop/disable only their deterministic service and remove its
specific Caddy fragment. The worker then uses that store's restricted URI to
drop its non-system collections and verifies no customer collections remain.
It never uses an administrative URI to select arbitrary databases. It deletes
that store's Atlas user and independently verifies its absence (an HTTP 202
acceptance alone is insufficient), then moves local photo/queue/journal directories and
runtime environment into a root-only archive. The default is recoverable local
archiving, not recursive unlink of customer files. Permanent archive removal is
a separate operator-controlled retention decision.

A MongoDB cleanup or credential-removal failure prevents the closed
acknowledgment. Each successful destructive stage is durably recorded so retries
can recover after deleting a credential. A minimal local tombstone persists and
prevents mistakenly recreating a cleaned store with old secrets. The platform
keeps bonus eligibility/billing history separately; it must not recreate a
closed store under the same identity as a fresh promotional customer.

## Required live acceptance and limitations

Local tests cover independent resource bindings, malicious input, credentials
and filesystem restrictions, lease loss, ordering/retry, failure-before-publish,
archive failure handling and no-side-effect dry-run. They do not emulate Atlas,
systemd, TLS or the actual VM. Before marking automatic onboarding accepted:

- Run one allowed test-account checkout and verify the webhook, durable task,
  correct isolated DB credentials, process, indexes, public domain and owner
  dashboard status; verify a retry creates no duplicate stores or users.
- Verify cross-store reads/writes, staff cookies, photos and queue recovery stay
  isolated, including two simultaneously running store processes sharing one
  build. Confirm existing WhereBear and its printed legacy QR URLs still work.
- Complete a real new-store drawing/password confirmation, photo upload/search,
  renewal/failed-renewal/cancellation and plan-switch acceptance flow.
- Test service restart, interrupted provisioning, lease expiry, Atlas timeout,
  unavailable port and Caddy validation failure. Confirm failure never marks a
  paid customer as ready or a partly cleaned customer as closed.
- Verify five-minute reconciliation enforces grace/suspension without accruing
  suspended-period arrears and only marks expired retention for manual review.
- Test cleanup only on an explicitly disposable test store, after founder
  confirmation, and inspect both live MongoDB absence and private local archive.

Production setup remains incomplete until these external systems are configured
and the evidence is recorded. A health response, local suite, manifest or mock
provider alone is not end-to-end production acceptance.
