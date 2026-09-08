# Reviewed first installation of automatic store runtimes

Operator material prepared 2026-09-08 UTC from a **read-only** inspection of the
approved VM and the intended Atlas account. No command in the activation
sections has been executed. No Atlas upgrade has been authorized or applied. This
document supplements `AUTOMATED-STORES.md`; it is not a deployment record.

## Observed production baseline to preserve

| Item | Observed value |
| --- | --- |
| Target | `wherebear-prod-20260902 / wherebear-vm / northamerica-northeast2-b` |
| Public IP | `34.130.157.162` |
| Subdomain DNS | Read-only lookups of `onboarding-probe-20260908.whataisle.com`, `teststore1.whataisle.com` and `www.whataisle.com` all resolved to `34.130.157.162` on 2026-09-08 UTC. This confirms address resolution, not a new store's HTTPS/application readiness. |
| Platform release | `/srv/whataisle-platform/releases/511a4f7774479dd50f55a1e61dbf45138fec5588` |
| Platform unit | `/etc/systemd/system/whataisle-platform.service`, active, user/group `whataisle-platform`, `current` working directory |
| Platform startup | isolated Node `v24.18.0`, `server.js`, port `3000`, `MemoryMax=1200M`, graceful SIGTERM/60 s |
| Native build target | independently rechecked: Ubuntu `22.04`, Node `24.18.0`, `linux/x64`, glibc `2.35` |
| Platform secrets | `/etc/whataisle-platform/platform.env`; values were not displayed |
| Existing schema approval | `1cfd304e6f56bd22f81871c454648bf5a8eaa63d9c077d0a62fc6abc7bbab25d` |
| WhereBear | PM2 under `mystery`, `pm2-mystery.service` active, port `3002`; do not replace its user, Node, environment, working directory or PM2 configuration |
| Existing WhereBear Mongo destination | Read-only configuration inspection of the active port-3002 process and its current release on 2026-09-08 UTC found SRV host `wherebear-cluster.fm98z4w.mongodb.net` and database `wherebear`. No database connection or query was made during that VM inspection. The Atlas project and cluster were subsequently verified directly in the Atlas UI; see the separate account snapshot below. |
| PostgreSQL | loopback `5432`; existing daily off-VM backup timer active |
| Caddy | active under user/group `caddy`, local admin port `2019`, public `80/443` |
| New store services/configuration | absent: worker units, `/srv/whataisle-store/current`, worker JSON, generated Caddy directory |
| New variables in platform env | absent: all five server-side Prices, worker token, test allowlist |
| Capacity sample | 3,913 MiB total RAM, about 2,556 MiB available, no swap; 9.2 GiB free disk. This is not a load test. |
| VM service account | An earlier inspection reported none. A later 2026-09-08 UTC read-only recheck of both instance metadata and `compute instances describe` confirmed one configured identity with the `cloud-platform` OAuth scope. No token was requested. A subsequent read-only project IAM/API check is recorded below; identity presence and a broad OAuth scope alone do not establish usable Vertex ADC. |
| Existing WhereBear AI configuration | The current process/configuration has `OPENROUTER_API_KEY` present, `GEMINI_API_KEY` / `GOOGLE_API_KEY` absent, `GOOGLE_APPLICATION_CREDENTIALS` unset and `GOOGLE_CLOUD_PROJECT=wherebear-prod-20260902`. Key validity and default ADC locations were not tested. This neither proves existing AI is broken nor authorizes copying credentials to new runtimes. |

Preserve all four Caddy blocks byte-for-byte, including their retry/streaming
settings and the platform's `X-Real-IP` forwarding:

- `wherebear.help, www.wherebear.help` → `localhost:3002`
- `34.130.157.162.nip.io` → `localhost:3002`
- `wherebear.whataisle.com` → `localhost:3002`
- `whataisle.com, www.whataisle.com` → `localhost:3000`

The reviewed `/etc/caddy/Caddyfile` SHA-256 is
`b368ee1d777cb7becabf1c252a8ed63ad9a858c2859b3a2dd0faf46e38efbec8`.
The precise change is one appended line, after the existing closing brace:

```caddyfile
import /etc/caddy/whataisle-stores/*.caddy
```

There is **no wildcard catch-all route** and no change to those existing blocks.
An empty imported directory adds no store route. The worker later writes one
validated fragment only after that store passes its local identity/DB check.

## Private configuration inputs

Start with `infra/stores/bootstrap-settings.example.json` in a separately
approved root-owned `0600` file under a root-owned `0700` directory. Populate
values from the intended accounts. Do not put it in a release artifact, paste it
into a command line, print it, or copy WhereBear's environment into it.

| Input | Destination and requirement |
| --- | --- |
| `STRIPE_PRICE_USD_MONTH` | platform env; USD 19,900 cents, recurring month, exclusive tax |
| `STRIPE_PRICE_USD_YEAR` | platform env; USD 199,900 cents, recurring year, exclusive tax |
| `STRIPE_PRICE_CAD_MONTH` | platform env; CAD 19,900 cents, recurring month, exclusive tax |
| `STRIPE_PRICE_CAD_YEAR` | platform env; CAD 199,900 cents, recurring year, exclusive tax |
| `STRIPE_PRICE_CAD_TEST_MONTH` | platform env; CAD 100 cents, recurring month; test subscription uses no gift |
| `STORE_BILLING_TEST_EMAILS` | platform env; designated email allowlist; DB additionally limits successful test openings to three |
| `PROVISIONING_WORKER_TOKEN` | generated once by staging; identical value merged into platform env and root-only worker JSON; never sent to store runtime |
| `atlasProjectId`, `atlasClientId`, `atlasClientSecret` | worker JSON; Atlas service account able to manage database users in the intended Atlas project. This is not the GCP project ID. Missing credentials block installation, not a reason to share WhereBear's Mongo URI. |
| `atlasClusterName`, `atlasHost` | existing approved Atlas cluster, with supported auto-embedding/vector/text indexes. No new cluster or broad IP allowance is created. |
| `commonRuntimeEnv.GEMINI_API_KEY` | explicit API-key path for new-runtime AI; do not infer it is inherently required by this VM. The optional ADC path requires the explicit identity/review declaration described below; the actual model request remains part of activation acceptance. |
| `commonRuntimeEnv.OPENROUTER_API_KEY` | explicitly approved scan key; stored in each root-only runtime env, not the shared release |
| `commonRuntimeEnv.GOOGLE_CLOUD_PROJECT` | must remain `wherebear-prod-20260902`; configuration alone does not grant API access |

The installer **does not change** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
mail/storage/database settings or the legacy `NEXT_PUBLIC_STRIPE_PRICE_*`
variables. All five new Prices must belong to the same Stripe account and mode
as the existing server key. Any sandbox endpoint pause, webhook secret change
or account/mode switch is a separate concrete Stripe change, coordinated with
the billing verification plan before executing it. Existing configured new-flow
values cause staging to refuse rather than silently rotate them.

Gemini authentication is selected explicitly in the bootstrap settings, separate
from the worker's runtime environment. Omission defaults to
`"geminiAuth": { "mode": "api-key" }`, which requires `GEMINI_API_KEY`. The existing
runtime selects the Gemini Developer API when that key is set; without it, it
selects Vertex with `GOOGLE_CLOUD_PROJECT` and the attached identity's ADC.

The optional attached-VM-identity path is:

```json
"geminiAuth": {
  "mode": "vertex-adc",
  "serviceAccountEmail": "EXPECTED_VM_SERVICE_ACCOUNT_EMAIL",
  "permissionsVerified": true
}
```

Replace the identity from the intended VM's private operational configuration;
set `permissionsVerified: true` only after the operator records the relevant
project IAM/API read-only review. It is an **operator declaration**, not a claim
that the script itself proved IAM or successfully called a model. There is no
extra verification file or expiry workflow. Staging runs on the approved VM,
first checking Linux/root/project/instance/zone, then requiring the current
metadata email to match and the `cloud-platform` OAuth scope to be present.
Only email/scopes are read: no metadata token or model request is made. `--review`
is portable and makes no metadata call. The chosen mode is recorded in the
root-only staging manifest.

ADC mode must omit `GEMINI_API_KEY` completely, since otherwise the runtime would
select the Developer API. Both modes require the separately configured
`OPENROUTER_API_KEY` and the approved `GOOGLE_CLOUD_PROJECT`. Arbitrary ADC keyfiles
or user credential files are outside this mode: the runtime environment allowlist
excludes `GOOGLE_APPLICATION_CREDENTIALS` and its HOME is a separate per-store
directory. No WhereBear credentials/configuration are copied to enable new stores.

A later 2026-09-08 UTC read-only project IAM check confirmed the VM identity has an
unconditional `roles/aiplatform.user` binding; the current role definition includes
`aiplatform.endpoints.predict`. `aiplatform.googleapis.com` is enabled. This
establishes the observed project-level prediction grant and API state, not an
end-to-end model test; inherited/deny policies, available quota and actual runtime
model execution were not tested. No IAM/API setting was changed.

The official generative-AI access-control guide lists `aiplatform.endpoints.predict`
for prompt requests. Its `serviceusage.services.use` guidance in ADC troubleshooting
concerns explicitly designating a quota/billing project, such as user ADC or the
`x-goog-user-project` header. This attached-identity path does not configure that
quota-project override; the runtime builder also disallows
`GOOGLE_CLOUD_QUOTA_PROJECT`. Do not add a Service Usage role merely because it is
absent from the observed Vertex role. The scoped real AI acceptance after activation
still verifies authentication, model availability and metering.
[Generative-AI permissions](https://cloud.google.com/vertex-ai/generative-ai/docs/access-control),
[attached-service-account ADC](https://cloud.google.com/docs/authentication/set-up-adc-attached-service-account),
[quota-project troubleshooting](https://cloud.google.com/docs/authentication/troubleshoot-adc)

## Atlas account snapshot and minimum capacity plan

The following was observed **read-only in the Atlas UI on 2026-09-08 UTC**, in
addition to the VM configuration inspection above. No cluster, user, policy,
index, billing setting or credential was created or changed.

| Item | Verified observation |
| --- | --- |
| Organization | `RL's Org - 2024-09-28`, ID `66f860ee64ca15604a064088` |
| Project | `wherebear`, ID `6a05168a4406869d3ac40a04` |
| Cluster | `wherebear-cluster`, Free (`M0`), MongoDB `8.0.32` |
| Provider and region | AWS `us-east-1`; this is the existing Atlas location, distinct from the GCP serving VM |
| Data | `200.94 MB / 512 MB` (UI: 39%) |
| Connections | `16 / 500` at inspection; a sample, not a capacity test |
| Search/vector allowance | UI explicitly showed **2 of 3** cluster-wide indexes used |
| Existing text index | `wherebear.products.text_index`, Search with dynamic mapping, `READY`, queryable checked, `14,482 / 14,482` documents (`100%`), size `365.81 MB` |
| Existing vector index | `wherebear.products.vector_index`, `READY` and queryable. Visible JSON confirms an `autoEmbed` text field at `search_text` with `voyage-4-large`, plus a `filter` at `latest_aisle`. The UI reports defaults: scalar quantization, 1024 dimensions and cosine similarity. Indexed `14,482 / 14,482` documents (`100%`), size/recommended memory `14.7 MB`. |
| Current-month embedding usage | Model `voyage-4-large`: query `748` tokens / `302` requests; indexing usage displayed `0`. This is a point-in-time usage snapshot, not a monthly allowance or full workload test. |
| Free Usage snapshot | Organization-wide one-time model balances, not monthly: `voyage-4-large` used `609,073 / 200,000,000` tokens (`0.3%`); the later 2026-09-08 recheck confirmed it remains within the free allocation. `voyage-4` used `0 / 200,000,000` tokens at the earlier snapshot. |
| Signed-in human role | `Project Owner`; this does not establish the worker service account's access |
| User-managed service accounts | The project's Applications → Service Accounts → User Managed page displayed “No service accounts yet”. No account was created. This does not inventory System Managed accounts or legacy API keys. |
| Organization resource policies | The organization's Resource Policies page showed the empty state and Create Policy action on 2026-09-08. No organization resource policy was configured at this read-only check. |
| Payment method (corrected) | A later, fully loaded Billing Overview recheck on 2026-09-08 confirmed an already-linked card under Payment Method. The earlier “Not added yet” reading was incorrect: it belongs to Billing Email Address. No card was added or changed during these checks, and no card details were retained. This does not authorize a paid Flex upgrade. |
| Billing email | Billing Email Address displayed “Not added yet”; this is separate from the existing payment method. |
| Billing amounts | September month-to-date amount and usage both displayed US$0.00. The August last invoice showed US$0.00 amount due and US$0.00 total usage. These are observed account totals, not a future spending limit. |
| Database IP access | The project's IP Access List showed active `0.0.0.0/0` plus one operator `/32` entry. Authentication remains required; the network list currently permits connection attempts from any address. Before activation, review actual VM egress and required operator access, add explicit permitted addresses, verify connectivity, then remove the broad rule only under the approved deployment scope. No access rule was changed. |
| Local index-definition snapshot | Both complete definitions were read from their visible JSON editors; Save stayed disabled and Cancel returned to READY/queryable overviews. Private files and hashes are in `/Users/mystery/Desktop/dev/whataisle-atlas-review-20260908-d7jbzhoe` outside both Git worktrees (directory 0700/files 0600). Text uses only `mappings.dynamic: true`; the vector definition retains the existing model and field paths. This is configuration preparation, not a database-content backup; refresh/compare at the authorized backup window. |
| Still unverified / to configure | Worker permissions/credentials and API IP access, restricted runtime DB-user access, reviewed database IP restrictions, and remaining billing details. |

**Confirmed isolation prerequisite, later 2026-09-08 UTC check:** the actual
WhereBear process on port `3002` authenticated with role `atlasAdmin` on `admin`.
The check privately matched the configured SRV host to
`wherebear-cluster.fm98z4w.mongodb.net` and application DB to `wherebear`, then
issued only `{ connectionStatus: 1, showPrivileges: false }`. Only role/database
names were retained; no username, URI, password, document or expanded privilege
list was displayed. This is a verified broad legacy credential, not merely an
unverified new-worker configuration. Before any new-store data enters this shared
cluster, create a **new** runtime user with `readWrite` only on `wherebear`, switch
the old runtime to that user, and verify its search/scan/read/write paths. Do not
downgrade the existing administrative user: other operations may depend on it.
Keep that administrative credential only for operations, outside application
processes, and ensure all restarted runtime processes use the restricted user. New stores' own restricted users do not remove this legacy cross-store
access. No user, role, secret or process was changed during this inspection.
[Connection-status semantics](https://www.mongodb.com/docs/manual/reference/command/connectionStatus/)


The current PM2 entry executes `/usr/bin/npm` in
`/home/mystery/whataisle-releases/wherebear-20260905-final`; its package start
script is exactly `next start`. Read-only process ancestry showed the npm,
shell, Next launcher and PM2 daemon ancestors did **not** inherit `MONGODB_URI`
or `MONGODB_DB`; the serving child did, matching the resolved `.env.local`.
The release uses its installed `node_modules/@next/env/dist/index.js`. Its
isolated parser check with non-secret sentinel strings confirmed that an
existing process environment value takes precedence over `.env.local`.
Next's production lookup order is process environment → `.env.production.local`
→ `.env.local` → `.env.production` → `.env`. Recheck higher-priority sources at
cutover: editing `.env.local` and issuing a restart does not prove that a cached
PM2 or launcher environment was replaced. No restart or configuration edit was
performed for this check.

For the eventual credential cutover, preserve the previous configuration only
in a root-owned `0700` backup directory with `0600` files, switch the verified
environment source and explicitly recreate/update the PM2 process environment
as needed. Success requires a fresh serving-process identity check returning
only the intended `readWrite` / `wherebear` role plus real WhereBear regressions.
If rollback is necessary, keep new-store provisioning and access disabled while
restoring the previous configuration; do not expose new-store data to the broad
legacy runtime credential. Retain the old administrative user for operations
until its other consumers are understood.
[Next.js environment precedence](https://nextjs.org/docs/pages/guides/environment-variables#environment-variable-load-order)

Each new store needs **two** Search/vector indexes, in addition to its ordinary
unique product index. Free permits only three Search/vector indexes in total
per cluster; the observed two leave insufficient room for even the next store.
Flex permits ten: the existing two plus four new stores times two equals ten,
so **Flex is the minimum tier with sufficient index allowance for five stores,
including WhereBear**, with no spare search index or extra test-store allowance.
Ordinary MongoDB indexes do not consume this Search/vector allowance. Do not
remove an existing WhereBear index to make room. The index arithmetic establishes
eligibility, not a five-store performance guarantee.
[Atlas compatibility and limits](https://www.mongodb.com/docs/search/deployment/feature-compatibility/?deployment-type=atlas)

Flex includes 5 GB storage and unlimited data transfer. Official pricing states
**US$8–30 for 30 days**, billed hourly according to operations per second:
US$0.0110/hour at the base tier (up to 100 ops/sec), through US$0.0411/hour at the
highest listed tier (400–500 ops/sec). The US$30 cap applies to the Flex cluster;
it is **not a cap on the full invoice, model usage or applicable taxes**. Flex
uses shared resources; the current 39% Free storage sample is not proof of search
throughput or future five-store storage needs.
[Flex costs](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/),
[cluster pricing and intended workloads](https://www.mongodb.com/pricing)

Flex supports Automated Embedding. The prepared **new-store** worker uses
`voyage-4`, currently US$0.06 per million tokens. The observed **existing-store**
usage is `voyage-4-large`, whose official listed rate is US$0.12 per million tokens;
these are different models and have separate free allocations. Initial indexing,
document inserts/updates and queries consume tokens separately from the cluster
charge. Each model receives a one-time 200-million-token allocation shared across
the organization; it does not refresh monthly. The UI snapshot above now confirms
zero `voyage-4` tokens used and 609,073 `voyage-4-large` tokens used at inspection;
recheck those shared balances before execution because other projects or later
activity may consume them. They do not cap future paid usage. The official model
documentation explicitly includes Flex in its paid-cluster rate limits.
[Embedding support and rate limits](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/),
[embedding billing](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/)

The overview documentation still contains Preview wording, while MongoDB's dated
**2026-08-13 announcement explicitly declares Atlas Automated Embeddings generally
available**. Record this documentation discrepancy instead of claiming either
that the actual account is unconditionally ready or that the feature is still
necessarily in preview.
[Overview](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/),
[dated GA announcement](https://investors.mongodb.com/news-releases/news-release-details/mongodb-atlas-now-delivers-industry-leading-context-retrieval)

There are two different permission checks: the worker's Atlas service account
needs database-user management access (for example `Project Database Access
Admin`), while each restricted store `readWrite` user already includes
`createSearchIndexes` for its own database. An organization resource policy can
still prohibit new `autoEmbed` indexes while leaving existing WhereBear indexes
working. Verify that policy, API/data IP access and the actual cluster's
embedding support; on M10+ the documented auto-embedding prerequisite also
includes storage auto-scaling. None is established by a successful Mongo ping.
[Database-user API](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-creategroupdatabaseuser),
[index privilege](https://www.mongodb.com/docs/v8.0/reference/command/createSearchIndexes/),
[organization policies](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/management/),
[auto-embedding prerequisites](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/)

Stripe test charges do not make the infrastructure/model calls free. Approve
the incremental Gemini/OpenRouter/Atlas test budget separately, recheck the shared
embedding allowance, and explicitly approve any recurring cluster/storage cost
before an upgrade or auto-scaling setting change. Existing metering is not a
cross-provider hard spending cutoff.
[Atlas embedding billing](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/)

### Mongo backup readiness: read-only VM check

On 2026-09-08 UTC, SSH verified the approved project, VM and zone through metadata.
No database URI/environment value was read or displayed, no database connection
was made, and no export, package installation, service operation or IAM change
was performed. Existing SSH authentication and noninteractive read-only `gcloud`
commands worked without a login prompt.

| Check | Observed result |
| --- | --- |
| Existing scheduled coverage | `/usr/local/sbin/backup-platform-postgres.sh` backs up only local PostgreSQL database `whataisle` plus `/etc/whataisle-platform/platform.env` and checksums to the private bucket's `postgres/` prefix. It does **not** back up WhereBear's Mongo database, Search definitions, runtime configuration or local queue/photos. |
| Script identity | Installed SHA-256 `6daa6e3eac8522e75c124fb463436c45d58910543acfd881c62e0525a9451375` matched the repository script byte-for-byte. |
| Latest scheduled result | `whataisle-postgres-backup.service`: success / exit `0`, last execution `2026-09-07 07:00:32 UTC`; timer active/waiting, next scheduled `2026-09-08 07:00:00 UTC` at inspection. This proves that backup's recorded success, not Mongo recoverability. |
| Mongo backup scheduling | No Mongo backup unit or matching cron entry was found in the inspected systemd units, standard cron directories, root crontab or `mystery` crontab. No exhaustive claim about historical/off-host manual exports is made. |
| Tools | `mongodump`, `mongorestore` and `mongosh` absent from root PATH; relevant Mongo tools packages not installed. A bounded three-level search under `/opt`, `/usr/local`, `/root` and `/home/mystery`, excluding dependencies/caches and symlinks, found no such binaries. `gcloud`, `gzip`, `sha256sum` and Python are present. |
| Private directory | `/var/backups` exists, root-owned `0755`; existing PostgreSQL subdirectory is root-owned `0700`. Proposed `/var/backups/wherebear-mongo` does not yet exist; neither it nor `/root/backups` was created. |
| Disk sample | Root filesystem had `9,832,538,112` free bytes (about `9.16 GiB`); `/var/backups` and the WhereBear release are on that filesystem. This is not a measured Mongo archive size or a disk reservation. |
| Existing off-VM destination | `gs://wherebear-prod-20260902-whataisle-backups`: uniform bucket access enabled, public access prevention enforced, no public IAM binding, lifecycle configured, location `NORTHAMERICA-NORTHEAST2`. |
| Existing upload access | Instance identity has an unconditional bucket-level `roles/storage.objectCreator` binding. This supports new unique backup objects without a new IAM grant; that observed role does not grant downloading/overwriting existing objects. No upload/download or broader permission test was performed. |

The existing script's create-only JSON API upload/checksum approach can be reused
in a scoped Mongo backup procedure, with a separate `mongo/wherebear/` prefix and
unique run names in the **same private bucket**. The unchanged PostgreSQL script
cannot be invoked to produce a Mongo backup. No new bucket or cloud identity is
needed for this proposed destination; preserve its privacy and existing lifecycle.
[Existing backup implementation](../infra/vm/backup-platform-postgres.sh),
[backup runbook](../infra/vm/README.md)

The upgrade still needs these concrete backup preparations/execution steps:

1. Stage verified official Linux x86_64 MongoDB Database Tools compatible with
   MongoDB 8.0 in a dedicated tools directory, without changing the WhereBear
   release or Node/PM2 installation. Verify `mongodump` and `mongorestore` versions.
2. Create a fresh root-owned `0700` Mongo backup directory/run with files `0600`,
   and prepare the connection privately through a restricted `--config` YAML file.
   Do not pass URI/password values in argv, copy the full WhereBear environment,
   or put the connection file in a public/report/release artifact.
3. Verify the dump's account can read the intended `wherebear` database, capture
   its collection counts and both full Search/vector definitions separately,
   then drain and halt all application Mongo writers before the **final** dump.
   Free clusters do not support `mongodump --oplog` or `--dumpDbUsersAndRoles`, so
   do not promise a consistent all-collection live dump using those options.
4. Export only the intended database to a new compressed archive, capture exit
   status/errors in restricted files, verify nonempty output and checksum, and
   upload archive/manifest/index definitions using unique create-only objects.
   Confirm remote size/checksum, then verify a private off-VM download using an
   existing authorized reader; do not expand the VM's role solely for that check.
5. Restore the archive into an isolated disposable MongoDB 8.0 environment and
   compare collections/counts/ordinary index definitions. Record Search/vector
   definitions separately: a successful document restore does not prove search
   indexes or auto-embedding are ready. Never restore over production as a drill.
   Only after recoverability is verified should the prepared Atlas upgrade run.

These steps remain unexecuted. The Atlas Free tier does not offer normal enabled
backup snapshots; its existing replica set is not the missing pre-upgrade backup.
Flex's future daily backups do not replace this pre-change export and restore
verification. Preserve failed/partial backups for inspection instead of overwriting
an existing run.
[Mongo dump security/options](https://www.mongodb.com/docs/database-tools/mongodump/),
[Free-tier dump restrictions](https://www.mongodb.com/docs/database-tools/mongodump/mongodump-behavior/),
[Free backup limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)

### Prepared Mongo Tools and private backup commands (not executed)

Official Database Tools **100.18.0** supports Ubuntu **22.04 x86_64** and MongoDB
**8.0**. Use the same tools version for dump and restore. The official download
catalog was read on 2026-09-08; no binary was downloaded. Select the standalone
TGZ, which needs no Mongo server installation or change to Node/PM2:

- Archive: [Ubuntu 22.04 x86_64 TGZ](https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.18.0.tgz)
- Publisher SHA-256: `09b14223910dea32fc36fe5eb28cd78e7a2415b0cef1feb981383dc6231ee194`.
- Source of URL/checksum: [MongoDB release catalog](https://downloads.mongodb.org/tools/db/release.json), entry `100.18.0` → platform `ubuntu2204` / `x86_64` → `archive`.

[Supported server/platform matrix](https://www.mongodb.com/docs/database-tools/),
[installation/download selection](https://www.mongodb.com/docs/database-tools/installation/)

After execution is authorized, run the following in a root Bash session on the
verified VM. Retain the unique tools directory; do not replace system binaries.
The expected digest is a publisher value, not a digest calculated from an
unverified download. If version or digest changes, review the new catalog entry
instead of silently accepting it.

```bash
set -euo pipefail
set +x
umask 077
install -d -m 0700 /opt/whataisle-backup-tools
mongo_tools_run=$(mktemp -d /opt/whataisle-backup-tools/tools-100.18.0-XXXXXX)
mongo_tools_archive="$mongo_tools_run/mongodb-database-tools-ubuntu2204-x86_64-100.18.0.tgz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.18.0.tgz' \
  --output "$mongo_tools_archive"
printf '%s  %s\n' \
  '09b14223910dea32fc36fe5eb28cd78e7a2415b0cef1feb981383dc6231ee194' \
  "$mongo_tools_archive" | sha256sum --check --strict
tar --extract --gzip --file "$mongo_tools_archive" --directory "$mongo_tools_run"
mongo_tools_bin="$mongo_tools_run/mongodb-database-tools-ubuntu2204-x86_64-100.18.0/bin"
"$mongo_tools_bin/mongodump" --version
"$mongo_tools_bin/mongorestore" --version
```

The later bounded VM inspection found that the current release's `.env.local`
is a symlink to **`/home/mystery/wherebear/.env.local`**, whose mode is `0600`,
owner UID `1001`, group GID `1002`. Its `MONGODB_URI` and `MONGODB_DB` matched the
current `3002` process values. Its URI database is compatible with an explicit
`--db=wherebear`; preserve the original authentication options and SRV resolution.
The saved PM2 dump did not supply these variables and must not be used as their
source. These checks read values only inside the inspection process and returned
paths, permissions, presence and equality results, never the values themselves.

Create a fresh private run, then extract **only** `MONGODB_URI` using Node 24's
dotenv parser. This does not execute the environment file or export its values
to a shell. JSON is valid YAML for this simple `--config` document. The helper
checks the known source and destination before writing a new `0600` file and
suppresses raw exceptions. Recheck the source path/ownership if the old store
has been redeployed or its credentials changed since this snapshot.

```bash
install -d -m 0700 /var/backups/wherebear-mongo
mongo_backup_run=$(mktemp -d /var/backups/wherebear-mongo/run-XXXXXX)
node --input-type=commonjs - "$mongo_backup_run" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
try {
  const source = '/home/mystery/wherebear/.env.local';
  const run = process.argv[2];
  const sourceStat = fs.lstatSync(source);
  const runStat = fs.lstatSync(run);
  if (process.getuid() !== 0 || !sourceStat.isFile() || sourceStat.uid !== 1001 ||
      (sourceStat.mode & 0o777) !== 0o600 || sourceStat.size > 1048576 ||
      !run.startsWith('/var/backups/wherebear-mongo/run-') ||
      fs.realpathSync(run) !== run || !runStat.isDirectory() ||
      runStat.uid !== 0 || (runStat.mode & 0o777) !== 0o700) throw Error();
  const env = parseEnv(fs.readFileSync(source, 'utf8'));
  const uri = new URL(env.MONGODB_URI);
  if (uri.protocol !== 'mongodb+srv:' ||
      uri.hostname !== 'wherebear-cluster.fm98z4w.mongodb.net' ||
      env.MONGODB_DB !== 'wherebear' ||
      !['', '/', '/wherebear'].includes(uri.pathname)) throw Error();
  fs.writeFileSync(path.join(run, 'dump.yml'),
    JSON.stringify({ uri: env.MONGODB_URI }) + '\n', { mode: 0o600, flag: 'wx' });
} catch {
  process.stderr.write('Private backup configuration was not prepared.\n');
  process.exitCode = 1;
}
NODE
```

`--config` supports `uri`, `password` and `sslPEMKeyPassword`; do not add a
conflicting command-line URI/password. The WhereBear credential is used only
for its own backup, never for provisioning a new store. Keep `dump.yml` on the
VM in the restricted run; exclude it from archive uploads and release artifacts.
[Sensitive-option configuration](https://www.mongodb.com/docs/database-tools/mongodump/#std-option-mongodump.--config)

Once all writers are drained/stopped and before Atlas starts its upgrade, export
the single database. The archive contains ordinary collection options/index
definitions; ordinary indexes rebuild on restore. `--archive` must not be combined
with `--out`. Record exit status and preserve a failed partial run. Tool output
is suppressed here to prevent URI-bearing errors reaching terminal transcripts
or logs; any later diagnosis must sanitize in memory before emitting anything.

```bash
if "$mongo_tools_bin/mongodump" \
  --config="$mongo_backup_run/dump.yml" --db=wherebear \
  --archive="$mongo_backup_run/wherebear.archive.gz" --gzip \
  --readPreference=primary --numParallelCollections=1 --quiet >/dev/null 2>&1
then
  printf 'exit=0\n' > "$mongo_backup_run/dump.status"
else
  mongo_dump_status=$?
  printf 'exit=%s\n' "$mongo_dump_status" > "$mongo_backup_run/dump.status"
  exit "$mongo_dump_status"
fi
test -s "$mongo_backup_run/wherebear.archive.gz"
gzip --test "$mongo_backup_run/wherebear.archive.gz"
(cd "$mongo_backup_run" && sha256sum wherebear.archive.gz > archive.sha256)
```

**Search/vector definitions need a separate file.** Do not treat `mongodump`'s
ordinary index metadata as a backup of Atlas Search. Using the existing MongoDB
Node driver, read the URI from `dump.yml` inside the process, explicitly select
`wherebear`, and write the result of
`db.collection('products').aggregate([{ $listSearchIndexes: {} }]).toArray()`
directly to a new `0600` `search-indexes.json`. Preserve both full records, including
`name`, `type` when returned, `latestDefinition`, definition version and readiness;
require `text_index` and `vector_index` with complete definitions. Retain any
additional index found, rather than dropping it to fit the earlier snapshot.
Also save each collection's type/options, `countDocuments({})`, and ordinary
`listIndexes()` definitions in `database-manifest.json`; views need their options,
not a materialized replacement. Capture this final baseline while writes are
halted. Drivers and helpers must never print the URI or raw exceptions. If the
existing credential cannot list Search definitions, use the already-authorized
Atlas UI/API to save them privately; do not silently skip or grant permissions.
[Search-index listing and complete definitions](https://www.mongodb.com/docs/manual/reference/operator/aggregation/listSearchIndexes/),
[ordinary dump contents and view behavior](https://www.mongodb.com/docs/database-tools/mongodump/mongodump-behavior/)

For the restore drill, prepare a **fresh isolated MongoDB 8.0 instance**, preferably
the observed patch `8.0.32`, on a separate loopback port with its own empty data
directory. The backup data is private even when restored locally. Use an explicitly
reviewed local target config (`restore-local.yml`, mode `0600`); its `uri` must
point only to that instance, with `directConnection=true`, and contain no source
Atlas credentials. Do not fall back to port `27017` or the source config. Confirm
the target identity, source/target version or FCV, and an empty destination before
executing. The following renames only the original database to the fresh drill DB:

```bash
mongo_restore_db=wherebear_restore_drill
if "$mongo_tools_bin/mongorestore" \
  --config="$mongo_backup_run/restore-local.yml" \
  --archive="$mongo_backup_run/wherebear.archive.gz" --gzip \
  --nsInclude='wherebear.*' --nsFrom='wherebear.*' \
  --nsTo="$mongo_restore_db.*" --stopOnError --numParallelCollections=1 \
  --quiet >/dev/null 2>&1
then
  printf 'exit=0\n' > "$mongo_backup_run/restore.status"
else
  mongo_restore_status=$?
  printf 'exit=%s\n' "$mongo_restore_status" > "$mongo_backup_run/restore.status"
  exit "$mongo_restore_status"
fi
```

Do not add `--drop`, `--noIndexRestore`, `--noOptionsRestore`, `--oplogReplay` or
archive-mode `--db`/`--collection` to this drill. `--stopOnError` prevents ignored
duplicate-key/validation failures. A zero exit alone is insufficient: compare
all restored collection/view names, exact counts, options and ordinary index
definitions to the manifest, allowing only the intentional namespace/UUID change.
TTL indexes can remove already-expired records after restoration; document any
such collections before the drill and compare with an explicitly accounted TTL
policy, not an unexplained count discrepancy. Check the downloaded off-VM
archive against its original SHA-256 as a separate storage-recovery check.
Search/vector definitions must be retained for Atlas recovery and both indexes
must reach `READY`/queryable after rebuilding; a plain MongoDB document restore
does not validate Search or automated embedding.
[Restore options](https://www.mongodb.com/docs/database-tools/mongorestore/),
[compressed archive and namespace examples](https://www.mongodb.com/docs/database-tools/mongorestore/mongorestore-examples/)

### Prepared Free-to-Flex change and recovery checks

**No Atlas upgrade has been authorized or executed.** This is a prepared change
for the existing `wherebear-cluster`, keeping AWS `us-east-1`; it is not performed
by the bootstrap scripts or the platform's `main` workflow.

Atlas supports upgrading the original Free cluster to Flex. Official guidance
requires **downtime, halted writes throughout the scale operation, and restarting
application clients after the upgrade**. Existing Search/vector indexes are
rebuilt with an initial sync. Neither the observed data size nor the general
cluster provisioning estimate establishes the complete search recovery time;
there is no verified duration for this cluster. Do not promise a five- or
ten-minute outage or treat database connectivity as search readiness.
[Upgrade requirements](https://www.mongodb.com/docs/atlas/scale-cluster/),
[index rebuilding](https://www.mongodb.com/docs/search/deployment/feature-compatibility/?deployment-type=atlas)

SRV connection strings discover changed nodes through DNS, but the official FAQ
does not provide a specific unchanged-full-URI guarantee for this same-region
Free-to-Flex operation. Preserve provider/region, privately compare the post-
upgrade Connect host with the recorded SRV host, and test the original application
connection without displaying its credentials. Update only the necessary private
configuration if the returned endpoint differs. Do not mistake the FAQ's
zero-downtime guidance for changing a **dedicated** cluster's provider for a
Free-to-Flex availability guarantee.
[Connection-string guidance](https://www.mongodb.com/docs/atlas/reference/faq/connection-changes/)

Prepared execution sequence, once that change is within the authorized scope:

1. Complete the outstanding read-only account/policy/allowance checks above and
   recheck both named indexes and capture their full definitions. Record collection
   counts and verify a recoverable private Mongo backup, separate from the
   platform's PostgreSQL backup; keep data and credentials out of this document.
2. Arrange an operational interruption for WhereBear, drain its active scans and
   halt **all** Mongo writers, including background jobs. Keep new provisioning
   inactive. A shopper search may itself write logs, so blocking uploads alone
   does not satisfy the required stop-write boundary.
3. Review Free to Flex on the same cluster/provider/region, including the
   displayed charge and Atlas warnings, then apply only that reviewed change.
   Do not add a Search Node, move regions, create another cluster or change
   existing index definitions as part of this operation.
4. After Atlas finishes the cluster change, verify the endpoint privately and
   restart the relevant application clients in a controlled way. Verify DB
   connectivity and pre/post data counts, plus both original index definitions.
5. Require both existing indexes to report **`READY` and `queryable: true`**;
   `STALE` can remain queryable while returning outdated data. Verify actual
   WhereBear shelf search and the scoped scan/search acceptance before restoring
   normal traffic and allowing new provisioning. A real embedding/scan test
   consumes the separately accounted model budget.

These are proposed recovery criteria. They have not been exercised against
Atlas, and the local bootstrap rollback does not undo a cluster upgrade.
[Index readiness states](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-getgroupclustersearchindex)

## What main deploy does, and what it does not do

`.github/workflows/deploy.yml` builds/publishes **only the platform**. It neither
builds this store application nor installs worker units/configuration/Caddy,
applies migration `0021`, approves the new schema digest, or enables timers.
An ordinary push alone cannot complete this installation. Keep the production
schema approval gate: do not update its file merely to bypass a failed deploy.

Use one reviewed full Git commit containing the intended source/assets. The
current uncommitted tree is not a release identifier. Obtain an Ubuntu 22.04
x86_64/glibc 2.35
store artifact and independently trusted checksum using:

```sh
bash scripts/store-build-release.sh FULL_COMMIT_SHA /new/absolute/build-directory
```

The preferred prepared option uses the existing local Docker engine. From the
reviewed source checkout, preview the command without creating files or starting
Docker:

```sh
bash scripts/store-build-container.sh FULL_COMMIT_SHA /new/absolute/store-output --plan
```

After the candidate commit and local build are approved, use the same arguments
with `--run`. The helper shallow-copies that one committed tree into a private
bare repository, rejects tracked environment files, mounts only that snapshot
read-only and a new output directory read-write, and builds under an official
Ubuntu `22.04` `linux/amd64` image pinned by manifest digest. It downloads official
Node `24.18.0` and checks its pinned SHA-256 before execution. It mounts no home,
SSH keys, Docker socket, production environment, or original WhereBear working
directory. Both public pins are recorded in the script. Public apt/npm/Node
downloads happen inside the ephemeral build container; neither cloud compute
nor a CI run is requested. The helper retains the private snapshot and output
for inspection, including on failure; archive those only after reviewing them.

The local Docker engine is ARM, so this path uses x86_64 emulation with a
4-CPU/6-GiB limit. Its speed and the complete Linux build have not yet been
verified. If local emulation is unsuitable, an inactive build-only alternative
is in `infra/stores/store-build.workflow.example.yml`; using it requires a
separate decision about the runner and its available allowance. That template
stays outside `.github/workflows` and has no deployment or runtime credentials.

Build away from the live WhereBear directory and the 4-GiB serving VM; no
additional customer VM is required. Existing cached Alpine/musl Node images are
not compatible build defaults.
The builder now rejects musl, ARM, other distributions, and glibc versions other
than the observed `2.35` **before** extraction/npm. It records OS, architecture,
libc and glibc in `store-runtime-manifest.json`; preparation/initial installation
also reject an incompatible or missing native-build manifest. Future OS/Node
upgrades require a new reviewed target, not weakening the check ad hoc.

After approved transfer to the target VM:

```sh
sudo bash scripts/store-prepare-release.sh FULL_COMMIT_SHA /absolute/store-COMMIT.tgz TRUSTED_SHA256
```

This only extracts `/srv/whataisle-store/releases/<commit>`; it does not switch
any running store. The preparer refuses an existing release path or unsafe tar
entries. Include the reviewed `scripts/store-*.{mjs,py,sh}` and `infra/stores/`
assets in the private operator bundle, preserving those relative directories.
The installer uses only the three worker modules and five unit files, not the
WhereBear Caddy template or registry.

## Prepare and review candidates

Portable, no-side-effect previews:

```sh
node scripts/store-stage-bootstrap.mjs --review
python3 scripts/store-install-bootstrap.py --review
```

After installation authorization and private input preparation, run on the VM:

```sh
sudo /opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node scripts/store-stage-bootstrap.mjs --stage /root/private/bootstrap-settings.json FULL_STORE_RELEASE_COMMIT
```

This verifies the VM and original Caddy hash, then creates a new root-only
`/var/lib/whataisle-provisioning/bootstrap/<timestamp>-<suffix>/` containing:

- Exact original Caddy and platform environment backups.
- Candidate platform environment preserving every original setting and adding
  only the five Prices, test allowlist and new shared token.
- Candidate root-only worker JSON, full merged Caddyfile and reviewed unit/scripts.
- `manifest.json` with commit, fixed destinations and SHA-256 values; no raw
  secret in the manifest or terminal output.

It does not install, reload, restart, claim a job, create an Atlas user or change
a database. Inspect key **names**, digests and the one-line Caddy diff without
printing `platform.env.*` or `worker.json.candidate`.

## Authorized installation and activation order

1. Record the current platform release and configuration/schema digests again.
   If they differ from the observation above, inspect the new state first. Run
   the existing approved backup service and confirm a new successful off-VM
   backup plus restore/checksum evidence before the schema write:

   ```sh
   sudo systemctl start whataisle-postgres-backup.service
   sudo systemctl show whataisle-postgres-backup.service --property=Result,ExecMainStatus
   ```

2. Apply only the reviewed migration history through `drizzle-kit migrate` from
   a clean reviewed source checkout, using the platform's existing environment
   file under systemd (never shell `source`). Confirm the target is the local
   `whataisle` database on `5432` first. `0021_light_vapor.sql` adds six new tables
   and their indexes/FKs; do not use `db:push`, seed data, or manually mark the
   migration successful. Validate the tables and existing data before approving
   the new schema digest. Compute the digest with the same tracked-file formula
   as CI and retain the previous approval file in the private backup:

   A clean source checkout with its Linux dependencies is required; the deployed
   standalone package deliberately does not contain migration tooling. Replace
   `REVIEWED_SOURCE_DIRECTORY` and the unique unit suffix after preparing it:

   ```sh
   sudo systemd-run --wait --pipe --collect --unit=whataisle-onboarding-migrate-REVIEWED_SUFFIX \
     --property=User=whataisle-platform --property=Group=whataisle-platform \
     --property=WorkingDirectory=REVIEWED_SOURCE_DIRECTORY \
     --property=EnvironmentFile=/etc/whataisle-platform/platform.env \
     /opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node --input-type=module -e '
       import { spawnSync } from "node:child_process";
       const target = new URL(process.env.DATABASE_URL);
       if (!["localhost", "127.0.0.1"].includes(target.hostname) ||
           !["", "5432"].includes(target.port) || target.pathname !== "/whataisle" ||
           target.searchParams.has("host")) throw new Error("Unexpected database target");
       const result = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { stdio: "inherit" });
       process.exit(result.status ?? 1);
     '
   ```

   This command is a production schema write and belongs only in the authorized
   execution phase. The service user must be able to read that reviewed checkout;
   no secret is passed as a command-line argument. Inspect migration status using
   peer-authenticated read-only SQL instead of displaying the connection string:

   ```sh
   sudo -u postgres psql -d whataisle -XAtc "select tablename from pg_tables where schemaname='public' and tablename in ('store_owner_entry','store_runtime','store_billing_event','store_billing_notice','store_checkout','store_subscription') order by tablename"
   ```

   ```sh
   git ls-files -z src/db | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
   ```

   Copy only that first SHA-256 field to
   `/etc/whataisle-platform/approved-schema.sha256` after compatibility review.
   A platform rollback never deletes these six tables or restores an old DB
   over new payments. The legacy platform can keep using its existing tables.

3. Write the reviewed candidates to disk with the staging directory returned
   above. This refuses changed config digests, pre-existing new service files,
   customer worker state, incomplete store release, or invalid merged Caddy:

   ```sh
   sudo python3 scripts/store-install-bootstrap.py --install /var/lib/whataisle-provisioning/bootstrap/RETURNED_DIRECTORY
   ```

   It creates `/srv/whataisle-store/current` for **new** runtimes and installs
   only new units/scripts/secrets plus the two merged config files. It does not
   touch the platform unit or PM2 and does not activate anything.

4. Publish the reviewed platform commit through the existing `main` workflow.
   Its candidate check and restart affect only `whataisle-platform.service`.
   The restarted platform loads the added server-side Price/token variables.
   Before enabling workers, verify the deployed new routes exist; an unauthenticated
   `POST` with `{}` to `/api/internal/provisioning/claim` and
   `/api/internal/billing/reconcile` must return **401**, not 404 or 500. Omit the
   bearer token for these probes so no task or billing work can be performed.

5. Validate/reload Caddy and register the new units. The import is still empty:

   ```sh
   sudo systemctl daemon-reload
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   ```

   Check platform and all existing WhereBear/legacy HTTPS hosts with read-only
   requests; confirm the original PM2 service remains active on port `3002`.

6. Only after Prices, Stripe webhook mode/events, Atlas user/index privileges,
   approved AI keys, schema and read-only route checks pass, enable the two
   workers. **This is the boundary that permits queued customer tasks and
   subscription reconciliation to make external/data changes.** Inspect pending
   `store_runtime` tasks first; do not assume the queue is empty.

   ```sh
   sudo systemctl enable --now whataisle-provisioning.service
   sudo systemctl enable --now whataisle-billing-reconcile.timer
   sudo systemctl show whataisle-provisioning.service --property=ActiveState,SubState
   sudo systemctl list-timers whataisle-billing-reconcile.timer
   ```

7. Run the explicitly approved disposable-account/store acceptance through
   payment → setup → job → restricted DB/indexes → domain → PIN/map → scan/search,
   then Stripe renewal/cancel/plan-switch cases. Verify store identity on public
   `/api/runtime/health` and that no WhereBear process/data/route was replaced.
   See `AUTOMATED-STORES.md` for failure/retry/archive acceptance. Do not treat a
   ready page or an empty Mongo ping as a successful real scan/search test.

## Rollback boundaries

**Before the new workers have run**, restore exact previous config and archive
only the newly installed files using:

```sh
sudo python3 scripts/store-install-bootstrap.py --rollback-before-start /var/lib/whataisle-provisioning/bootstrap/RETURNED_DIRECTORY
```

The script refuses active new workers, any per-store state, a changed symlink or
config/assets edited after installation. It moves new assets into the same
root-only `withdrawn/` directory and restores original config files. It does not
stop any service, reload Caddy or reverse a schema migration. If Caddy/new unit
definitions were previously loaded, follow with `systemctl daemon-reload` and
the same Caddy validate/reload commands. If the new platform was activated,
restore its previous approved release with the existing platform activation
tool and compatible schema approval; only the platform process restarts.

**After any store job has started**, this initial rollback is deliberately
blocked. Stop new provisioning and the reconcile timer only, preserving every
store process, DB, runtime secret, queue and photo directory. Record the active
job/lease and paid entitlement before resuming or retrying it. Do not remove the
Caddy import when customer fragments exist, drop new store databases, rotate the
global token independently, cancel Stripe subscriptions, or roll back customer
data as an infrastructure shortcut. Use the failed-job admin retry after fixing
the actual configuration, and keep original billing/bonus eligibility records.

No rollback returns to the retired GCP projects. Neither their billing nor
their stopped services is part of this procedure.

## Evidence still required

Local verification commands for these prepared assets:

```sh
node --test scripts/store-bootstrap.test.mjs
node --test scripts/store-build-platform.test.mjs
node --test scripts/store-build-container.test.mjs
python3 -B scripts/store-bootstrap-test.py
```

Twelve merge/CLI/auth-mode checks, four native-build-boundary checks, two container-plan/
snapshot checks and eight filesystem install/rollback checks pass. Snapshot
tests use real local Git commits and a recording Docker stub; they verify mounts
and exclusion of ignored/uncommitted data without starting a container. The
filesystem tests use real isolated temporary files; VM metadata, root ownership
and service commands are simulated. Seven auth-mode regressions cover default
API keys, explicit ADC review, identity/scope mismatch, mixed credentials,
metadata failure/provenance, malformed settings and the emitted runtime env. They are not evidence that live systemd,
Caddy or the machine's production permissions have been exercised.

The preparer/installer are locally reviewed and tested; they have not been run
against production. Live activation still needs the reviewed commit/artifact,
completed private inputs, schema backup/application, explicit activation and
real Stripe/Atlas/systemd/Caddy acceptance. The five-store cap and resource
ceilings remain deliberate; a sixth paid store requires an operator capacity
decision before accepting payment rather than silently provisioning more cloud
infrastructure.

The platform now enforces the five-store ceiling **before creating a payable
Stripe Checkout**, using the same PostgreSQL advisory transaction lock as store
setup. The ceiling includes the static deployment registry (WhereBear is customer
1), physical stores, paid owners who have not completed setup, and reserved/open
Checkouts. Registry and database entries are deduplicated by handle; owner payment
and Checkout reservations reuse that owner's existing physical store slot. A
confirmed failed or expired Checkout releases its reservation; an ambiguous
network response or an elapsed local expiration timestamp does not.

Queued, provisioning, retry, failed, suspended, retention-period and cleanup-in-
progress stores all occupy capacity, including historical stores with no runtime
record. A physical slot is released only after both `store.status = closed` and
`store_runtime.status = archived` confirm completed cleanup. Canceling renewal
does not free it. Existing-store renewal/recovery does not need an additional
slot; archived stores cannot be repurchased through this flow. The application
ceiling is fixed at five to match the approved MVP scope, so increasing the worker
configuration alone cannot silently permit additional sales. No new database
table or migration is required; existing Checkout rows hold the reservations.

Capacity acceptance includes concurrent service tests and an opt-in real local
PostgreSQL test (`tests/unit/store-billing-postgres-capacity.test.ts`) that holds
the lock on a separate connection, commits a competing reservation, and verifies
that only the available number of new Checkouts is created. It also verifies
registry deduplication, paid-to-store slot conversion, failed cleanup retention,
confirmed expiration/rejection, and ambiguous request recovery.
