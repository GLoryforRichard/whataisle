# Shared-VM MVP decision and migration checklist

Decision date: 2026-09-06 (America/Toronto).
Status: migration in progress; owner approved same-VM PostgreSQL with daily
off-VM backups. Initial data restore, media transfer, private platform startup
and off-VM restore drill passed. Production DNS/final-sync cutover NOT performed.

## Approved boundary

- WhatAisle is the SaaS product and maintained repository. WhereBear is customer
  1, with stable registry ID `wherebear`; additional stores belong to the same
  product, not independent code forks.
- Through five stores, share one application VM in one new-account GCP project.
  Revisit splitting after MVP validation with **more than five stores**. Capacity
  or availability issues before that threshold must be reported rather than
  silently provisioning more paid infrastructure.
- Target project: `wherebear-prod-20260902`; VM: `wherebear-vm`; zone:
  `northamerica-northeast2-b`; current public IP: `34.130.157.162`.
  Existing resource names are identifiers, not a declaration that the platform
  belongs to its first customer. A rename/new project is not required.
- Platform and store may remain separate application processes on loopback
  ports behind one Caddy instance. Sharing a machine does not merge databases,
  secrets, authentication, or store permissions.
- Keep WhereBear's current Atlas database, indexes, ADK/MCP and scan worker.
  Preserve legacy host HTTPS, same-origin APIs, and browser photo recovery.
- Do not use old accounts for new deployment or create new resources there.
  Access to old resources is limited to migration, verification, and separately
  verified cleanup. Do not restart the stopped old WhereBear VM.

## Source versus target

| Component | Verified source | Required target |
| --- | --- | --- |
| Platform website/account/billing app | `whataisle-prod` Cloud Run | Separate platform process on shared new VM |
| WhereBear store/scan worker | New VM, PM2 `wherebear-platform-final`, port 3002 | Preserve existing runtime and data |
| Platform PostgreSQL | Old Cloud SQL `whataisle-pg` still authoritative until cutover | PostgreSQL 17 on shared VM, initial restore verified; daily off-VM backup enabled |
| Store product/search data | MongoDB Atlas `wherebear` | Unchanged |
| Platform media | Old GCS bucket `whataisle-prod-whataisle-media` | New-account storage with preserved keys and verified access |
| Platform HTTPS entry | Old global load balancer | Shared VM/Caddy for apex and `www`; preserve store/legacy routes |
| Main deployment workflow | Old Cloud Run/Artifact Registry/WIF | New target only, after validation and source authorization |

Application routing after cutover: `www.whataisle.com` and the apex reach the
platform process; `wherebear.whataisle.com` reaches the existing store process.
Future store hosts require explicit identity/data/runtime configuration before
routing is enabled; a wildcard DNS record is not automatic store provisioning.

## Preflight findings — 2026-09-06

- New project's billing association is enabled on the intended new billing
  account. No billing switch or new chargeable resource was created in this
  preflight.
- Latest VM read-only sample: `e2-medium`, about 4 GiB memory, 2.9 GiB available,
  12 GiB disk free. This is an idle snapshot, not a capacity/load test.
- VM currently exposes Node `v20.20.2`; platform requires Node
  `>=24.18.0 <25` and pnpm `10.33.2`. Use an isolated compatible platform runtime
  without replacing the store's active Node/PM2 runtime in place.
- At initial preflight, the new-account CLI identity could not read the old Cloud Run service
  (`run.services.get` denied). The explicit old-account CLI check failed token
  refresh and requires reauthentication. Browser login alone does not refresh
  CLI credentials. This blocker was subsequently resolved in the execution
  record below; each account is used explicitly for its own project.
- The repository has unrelated uncommitted scan/cost-monitoring changes. Do not
  publish them incidentally or build an unidentified working-tree snapshot.
- The root website and store currently have separate builds and authentication.
  Customer 1 registration is not proof of unified account ownership/authorization.
- Platform image processing currently has higher internal concurrency than the
  old Cloud Run request limit. Re-evaluate request/image concurrency for the
  shared 4 GiB machine before routing traffic; idle memory is not sufficient
  evidence that simultaneous scans and platform requests will fit.

## Migration sequence and acceptance gates

1. Restore authorized source access. Read the deployed service configuration,
   database version/extensions, media inventory, workload identities and actual
   external integrations. Report variable names/identifiers only, never secrets.
   Keep the CLI default on the new project/account; explicitly scope source reads.
2. Determine the PostgreSQL destination and storage/backup cost before creating
   resources. Shared application VM approval does not by itself choose between
   self-managed PostgreSQL and managed SQL. Keep WhereBear Atlas unchanged.
3. Back up source platform data/configuration to a restricted destination.
   Validate restore into the chosen new destination, schema/extensions, row
   counts, ownership and access. Do not create a new empty production database
   as a substitute for migrating existing account/payment records.
4. Prepare an isolated platform release/runtime and restricted secrets on the
   new VM; use a verified-unused loopback port. Build outside the live store
   release, with the tracked release's required checks and production URL values.
   Build Linux-native dependencies on Linux, not by copying Mac `node_modules`.
   Replace Cloud Run-specific proxy/IP trust with the verified Caddy arrangement.
   Keep the existing worker as the single owner of WhereBear's scan queue.
5. Validate the platform privately using its production host, including real
   read-only account/session/database access and stored-media reads. Home page
   and `/api/ping` success alone do not validate database migration. Do not make
   a real purchase to test payment integration without explicit authorization.
6. Inventory all writers (signups, account updates, payment webhooks and any
   actually deployed jobs). Plan a bounded write pause, final synchronization
   and replay before switching; prevent divergent writes to two databases.
   Verify actual code before recreating old scheduler jobs/endpoints.
7. Prepare the new main-branch deployment path and credentials, then switch DNS
   and Caddy only after the data/configuration gates pass. Preserve unrelated
   DNS, MX/TXT, existing store routing and legacy recovery hosts. Disable the
   old publishing path as part of cutover, not by prematurely breaking current CI.
8. Verify platform login/account records, administrator customer 1 entry, media,
   store search/scan/queues and old printed QR URLs. Check webhook processing
   outcomes, not just HTTP response codes; avoid unapproved billable test calls.
9. Resolve old runtime/identity dependencies and review exact cleanup targets
   with data impact before deleting anything. Include SQL, load balancer/IP,
   registry artifacts, buckets and the stopped acoustic VM's retained disk/IP.
   Stopping a VM is not a zero-cost verification, and billing reporting may lag.

## Rollback and completion

- Keep restricted source/configuration backups until restore and cutover are
  verified. Do not automatically route back to or restart the old account: the
  owner has prohibited returning to it for normal operation.
- Prefer rollback between validated releases on the new VM. After new database
  writes begin, changing DNS back does not undo or reconcile those writes;
  explicit recovery/reconciliation is required before any data rollback.
- Mark application co-location complete only after traffic, data dependencies,
  workload identities, storage and future deployments all use the new target.
- Mark old-account retirement separately, after exact resource cleanup and a
  billing audit. Outstanding accrued charges are distinct from future usage.
- Unified customer account ownership, self-service provisioning and broader
  multi-tenant product work remain separate acceptance items. Co-location is
  not evidence that those features are complete.

## Execution record — 2026-09-06, preparation only

- Owner requested authorization of both accounts and immediate migration work.
  The new account's existing CLI credentials were valid and verified against the
  target VM/billing project. Old-account OAuth was completed in the owner's
  retained Chrome profile, and an explicit old-account Cloud Run read succeeded.
  The default CLI account/project remain the new destination. No account IAM
  privileges were expanded as part of login.
- Deployed source: Cloud Run revision `whataisle-00024-hcv`, image commit
  `8754f495436e4ce5a3546551f6a172248492a2a3`. Target release commit
  `d6cb8b82d69017bffb08c4d478f6efbdd517edd5` differs only in documentation.
- PostgreSQL source is 17.10, approximately 10 MB, with `pg_trgm` 1.6 and
  `vector` 0.8.1. Baseline includes 3 user rows, 3 account rows, 2 session rows,
  1 payment row and 21 migration records. All public/drizzle table counts were
  recorded; no customer row values were displayed or added to Git.
- Restricted local migration backup: `/tmp/whataisle-migration.Pd8hQP` (0700;
  raw configuration, secrets and dump files 0600). Custom-format database dump
  is 81,168 bytes; catalog and SHA-256 verified. Four media objects totaling
  25,189,672 bytes were copied with their original inventory/metadata. This is
  an initial snapshot, not the final write-frozen cutover snapshot. Do not rely
  on a temporary directory as the permanent backup destination.
- PostgreSQL 17 client utilities (`libpq@17`) were installed locally for the
  export; no local database server was created. Source access used a temporary
  Cloud SQL Auth Proxy on loopback, not a public database firewall exception.
  The temporary proxy was stopped after the backup/preparation phase.
- Clean-commit platform lint, 34 unit tests, typecheck and build passed in an
  isolated macOS directory. The 72 sitemap URLs and robots sitemap use the
  production hostname. No uncommitted scan/cost-monitoring changes were included.
- A separate Node 24.18.0 runtime and pnpm 10.33.2 were installed under
  `/opt/whataisle-platform` on the target VM; system Node/PM2 were not replaced.
  Linux build used real public production URLs/Stripe price variables but only
  compile placeholders for credentials; no source secrets were bundled.
- Linux standalone artifact was built and prepared at
  `/srv/whataisle-platform/releases/d6cb8b82d69017bffb08c4d478f6efbdd517edd5`,
  under a separate `whataisle-platform` OS service user. Artifact SHA-256:
  `4157ee09a85f7fb4096e582bbdac45d65bf4f667e3e0861b71de9f7fd9477053`.
  Source/build directory is
  `/home/mystery/whataisle-releases/platform-20260906-d6cb8b8`.
  Preparation did not create a current symlink or start any platform service.
- Target remained approximately 2.9 GiB available RAM / 9.7 GiB free disk after
  preparation. WhereBear remains on its existing process and port 3002.
- Local `infra/vm/` contains a prepare-only release script and inactive CI
  example. **The actual main-branch workflow still deploys to the old project**;
  do not push a migration release until that publishing path is replaced.
- Still pending: owner choice of self-managed PostgreSQL on the shared VM
  (recommended with off-VM backups) versus a separately billed managed instance;
  new storage/backup provisioning, restore verification, workload permissions,
  service startup, final writer freeze/sync, DNS/TLS/CI cutover, and old-resource
  retirement. No GCP database, bucket, DNS, IAM, billing or old runtime mutation
  has been performed in this preparation phase.

References: [release/data boundaries](WHEREBEAR-MERGE.md),
[platform workflow](../.github/workflows/deploy.yml),
[customer registry](../stores/registry.json),
[store runtime rules](../apps/wherebear/AGENTS.md).

## Execution record — approved shared PostgreSQL

Owner approved the recommended same-VM database and daily off-VM backup option.
The preceding preparation-only record is historical; the following supersedes
its pending-decision and no-cloud-mutations statements.

- Installed PostgreSQL 17.11 and pgvector 0.8.6 on the target VM only. PostgreSQL
  listens on 127.0.0.1:5432, 40 max connections, 128 MB shared buffers. No local
  laptop database and no new VM/Cloud SQL instance were provisioned.
- Restored the initial source dump without seeding or applying migrations.
  All 32 table counts matched, including users, accounts, sessions, payments and
  migration records. A separate TCP/password connection as the application role
  repeated all 32 checks with read-only transactions.
- Original auth/payment/mail/API settings preserved in root-only
  `/etc/whataisle-platform/platform.env`; DB URL, project and media bucket point
  to the new destination. Load-balancer IP trust disabled; platform AI and image
  concurrency limited to 2. Secrets are not in Git or release archives.
- New private uniform-access buckets, northamerica-northeast2:
  `wherebear-prod-20260902-whataisle-media` and
  `wherebear-prod-20260902-whataisle-backups`. Backups have a 30-day lifecycle.
  VM identity has media objectUser and backup objectCreator at bucket scope.
  Four media objects (25,189,672 bytes) preserve names/content metadata and MD5;
  all four were read and verified again using the actual VM identity.
- Daily backup uses direct JSON API create-only uploads, with no get permission
  or service-account key. Initial tests found and fixed the runuser PATH and
  snap ProtectHome incompatibilities; the CLI also required an unnecessary get
  probe, so it was replaced with objects.insert and response integrity checks.
  Daily backups also preserve the root-only runtime environment and checksum
  in the same private bucket; the VM identity cannot read stored backups.
- Successful backup `postgres/whataisle-20260906T132457Z.udRJ8xce.dump` and its
  SHA256 were downloaded from GCS and restored to a separate disposable DB.
  All 32 tables matched; only that newly-created drill DB was then removed.
  Daily timer enabled, 03:00 America/Toronto; local backups retained. No external
  failure notification configured yet; timer alone is not an alerting system.
- Platform unit `whataisle-platform` enabled, port 3000 on loopback, Node24.18.0,
  memory ceiling 1200 MB. Candidate and main page/ping/static checks passed.
  HTTPS forwarded-header check passed after using `HOSTNAME=localhost`: Next16
  normalizes 127.* to localhost, otherwise locale rewrites self-proxy wrongly.
  Wherebear PM2/3002 and MongoDB were not restarted or modified.
- WIF now restricts exact repository/owner numeric IDs, repository name and main
  ref/sub. New deployment SA has target-instance metadata SSH permissions,
  project lookup/operation reads, and actAs on only the attached runtime SA.
  Metadata SSH as mystery includes sudo on the shared VM; not directory-only.
  Actual VM network is `wherebear-vpc`, whose SSH firewall permits the operator
  address and IAP, not GitHub runner IPs. First deploy timed out on direct SSH.
  Workflow now uses IAP; deployment SA's IAP grant is target-instance-only,
  conditioned on destination port 22. No public SSH/firewall widening performed.
- GitHub publishing credentials updated to new WIF/SA. Commit
  `8c442eedc0565f1a1a7f165dd4649aed1730419b` pushed to main; actual deployment
  workflow now targets the new VM only. First CI/deploy run is being verified.
  Initial complete CI passed; the corrected IAP deploy is commit `511a4f7`
  (Actions run `34036347778`), currently being verified.
  No unrelated cost-monitoring source changes were staged or published.
- New Caddy configuration is prepared and validates, but is NOT installed yet.
  DNS registrar login has been requested. Old Cloud Run still serves the live
  platform; do not shut it or SQL down before write-freeze/final-sync/DNS checks.
  Initial snapshot is not a final synchronization, and old-resource charges are
  not yet resolved. Current app co-location is private readiness, not cutover.
