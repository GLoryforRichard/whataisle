# Platform release preparation (operator reference)

`.github/workflows/deploy.yml` builds and activates the platform on the new VM
only. These release scripts never change DNS, Caddy, Cloud Run, PostgreSQL or
Wherebear. Database compatibility requires an operator-approved schema digest;
the pipeline does not run migrations. Public traffic cutover is separate.

## Prerequisites

Target only `wherebear-prod-20260902 / wherebear-vm /
northamerica-northeast2-b`, Ubuntu 22.04 x64. Provision separately:

- Linux service user/group `whataisle-platform`.
- Root-owned, non-group/world-writable `/srv/whataisle-platform` and `releases`.
- `/opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node`.
- Restricted runtime environment `/etc/whataisle-platform/platform.env`; never
  package it, source it in an interactive shell, or print it in CI logs.
- Reviewed systemd unit `whataisle-platform`, loading that EnvironmentFile,
  WorkingDirectory `/srv/whataisle-platform/current`, Node absolute path above,
  `server.js`, `NODE_ENV=production`, `HOSTNAME=localhost`, `PORT=3000`.
  Allow graceful SIGTERM draining; do not restart the Wherebear PM2 worker.
- Root-owned `/etc/whataisle-platform/approved-schema.sha256`, matching the
  reviewed release manifest. Update only after backup/schema validation.

Use `localhost`, not `127.0.0.1`, for Next's startup hostname. Next 16 normalizes
127.* to localhost in NextURL; mixed origins cause language rewrites to become
external self-proxy requests and fail with HTTPS proxy headers. Actual listening
must remain loopback-only. Candidate and production HTTPS-header checks passed
on the target VM on 2026-09-06 with this configuration.

Build on Linux/glibc (the example uses Ubuntu 22.04), not macOS or Alpine:
native sharp/libvips dependencies must match the VM. Next 16 `DOCKER_BUILD=true`
enables the existing standalone output without requiring Docker. Public values
are baked into the build, so set GitHub repository variables to actual approved
production values. Runtime secrets must not be supplied to the build. Review
any additional public settings used by the current revision before enabling CI.

`platform-build.workflow.example.yml` is deliberately outside `.github/workflows`.
It is an optional build-only example, not the actual deployment workflow.
The real workflow uses GitHub OIDC restricted to this repository's main branch,
short-lived SSH keys, the new project and `mystery` metadata SSH. That user has
sudo on the shared machine; repository write controls remain a security boundary.

## Prepare, then validate

Transfer the artifact by the approved SSH identity. Verify its SHA256 against
the trusted build job (a digest accompanying an untrusted archive is not trust).
Then run `sudo bash infra/vm/prepare-platform-release.sh FULL_COMMIT_SHA
/absolute/path/platform-SHA.tgz SHA256` on the VM. It rejects wrong metadata,
existing releases, unsafe archive paths and embedded environment files. A
failed partial extraction is retained and must be inspected; it is never reused.

Before activation, run a temporary, separately named systemd candidate unit
from the prepared release as `whataisle-platform`, bound to `127.0.0.1:3001`.
Do not use a generic environment flag to assume background work is disabled:
review that revision's startup/instrumentation and use read-only credentials
where needed. `activate-platform-release.sh` launches and stops the candidate.
Check only reviewed read-only routes with `Host: www.whataisle.com`, including
`/api/ping`, the marketing page and static assets. Do not invoke scan, migration,
cron, signup, email, payment or re-embedding operations as a health probe.
HTTP 200 from `/api/ping` is **not database or business acceptance**. The migration
operator must separately validate restored records, tenant isolation, existing
sessions, uploads and approved business flows before declaring completion.

## Explicit activation and local rollback

Record the exact prior `current` symlink target and validate it is inside this
new VM's `releases` directory. Stop the candidate after preview. Under a single
deployment lock, create a uniquely named sibling symlink pointing to the new
release and atomically rename it to `current` (Linux `mv -T`); never overwrite
a real directory. Restart **only** `whataisle-platform`. Check service state,
loopback 3000 with the production Host header, then the public TLS route.

On failure, atomically restore the recorded prior symlink and restart only
the platform service. If no previous release exists, stop the platform service;
do not restart any old-account resources. Keep the failed release for diagnosis.
Do not touch Wherebear's PM2 process or port 3002. No release directory is
automatically deleted, and DB rollback is a separate reviewed operation.

Changing `current` does not roll back database schema, secrets, DNS or media.
Compatible schemas and a verified backup are prerequisites, not an assumption.

## Local verification

`bash -n infra/vm/*.sh` checks shell syntax (also check each file individually).
Prepare/activation have passed target-VM integration checks. A separate private
database-password connection verified all 32 restored table counts and the VM
identity read all four media objects. DNS cutover and live business acceptance
remain separate; do not infer migration completion from these checks.

The technical runbook follows the documentation skill's prerequisites,
procedure and rollback structure. Next-specific behavior was checked against
the installed Next 16 `self-hosting.md` and `next-config-js/output.md` guides.

## Local PostgreSQL daily off-VM backup

`backup-platform-postgres.sh` and the matching service/timer are operator-installed
assets, not automatically enabled by this repository. After the approved local
PostgreSQL 17 migration, install the script root-owned mode 0750 at
`/usr/local/sbin/backup-platform-postgres.sh` and the units root-owned mode 0644
in `/etc/systemd/system/`. The timer runs at 03:00 America/Toronto, including a
catch-up run after downtime (`Persistent=true`).

Provision `gs://wherebear-prod-20260902-whataisle-backups` separately in the new
project, with private access, an approved 30-day lifecycle, and object-create
permission for the VM service account. The script verifies project, VM and zone,
dumps only local database `whataisle` through PostgreSQL peer authentication,
and uses a short-lived VM metadata token with direct GCS JSON API uploads.
No service-account key or interactive user login is required.

Each run creates a unique UTC-named root-only directory under
`/var/backups/whataisle-postgres` (0700; files 0600), containing a custom-format
dump and SHA256 manifest, plus a root-only runtime configuration copy and its
checksum for disaster recovery. All upload to the private `postgres/` prefix using create-only object
preconditions. Any dump/upload failure fails the service and retains the local
copy and restricted diagnostic logs. Local backups are **never automatically
deleted**: monitor disk capacity and review retention separately. A completed
dump with no remote checksum is not a completed off-VM backup.

Before enabling the timer, run a one-shot backup, download and verify its
checksum, and restore to a separate disposable PostgreSQL 17 database with the
required extensions using `pg_restore --no-owner --no-acl`. Compare expected
record counts; never restore over production for a backup test. Only then run
`systemctl enable --now whataisle-postgres-backup.timer`. Check
`systemctl list-timers whataisle-postgres-backup.timer` and service exit status;
the timer itself does not provide off-machine failure notifications. To pause
future backups, disable/stop the timer; this does not delete existing copies.

2026-09-06: upload/download/checksum/restore drill passed against all 32 tables;
the disposable drill database was removed after verification. Timer enabled for
03:00 America/Toronto. This is still a pre-cutover snapshot, not the final sync.
