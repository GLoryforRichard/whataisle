# Customer onboarding release candidate

Prepared locally on 2026-09-08 UTC. **Not deployed; no production migration,
Atlas permission change, live payment or external AI scan has been performed.**

## Source and scope

- Base commit: `4271722`.
- Candidate branch: `codex/customer-onboarding-release`.
- The read-only remote-main check on 2026-09-08 still returned `4271722`.
  The known serving-platform commit `511a4f7` is its ancestor; both are ancestors
  of this candidate. No upstream application change is missing. The accepted
  store artifact's `8ae15a2` source remains identical to the candidate store tree;
  subsequent changes only record release evidence and deployment prerequisites.
- Candidate working directory: `/Users/mystery/Desktop/dev/whataisle-onboarding-release-20260908`.
- The original `/Users/mystery/Desktop/dev/whataisle` working tree retains the
  owner's pre-existing uncommitted work. This candidate excludes the earlier AI
  cost-accounting and permanent product-deletion features, and unrelated rules
  and review documents. Mixed store files were reconstructed from the committed
  base with only this task's necessary changes.
- Exact store-file extraction evidence:
  `apps/wherebear/docs/STORE-RELEASE-SCOPE.json`.
- Accepted behavior: `CUSTOMER-ONBOARDING-SPEC.md`. Operator activation and
  rollback review: `STORE-BOOTSTRAP-REVIEW.md`.

The candidate adds verified-account payment-first onboarding, five fixed
currency/period offers, one-time introductory months, term-end plan switching,
cancellation/grace/recovery, owner store setup and password management, isolated
store provisioning, public initial map drawing, server-verified staff access,
stable shelf identities and explicit retained-data cleanup. Six new PostgreSQL
tables carry billing, provisioning and owner-entry state.

Checkout reserves the approved five-store VM capacity before exposing a payment
URL. WhereBear, paid owners awaiting setup, retained stores and pending
checkouts occupy places; renewal/recovery does not consume an extra place.
Cleanup waits for any outstanding recovery checkout to settle, even after its
local expiry time, so an issued Stripe page cannot charge while data is archived.

Automatic account deletion is unavailable in this release. All three Better
Auth deletion entry points reject before deleting sessions or credentials, and
the self-service delete control is hidden. Subscription cancellation remains
available; account deletion goes through support. This avoids both partial
credential deletion on billing foreign-key failure and a deletion/checkout race.

## Verification evidence

| Check | Result |
| --- | --- |
| Platform production build without private environment | Passed on the final source, including scoped E2E fixture cleanup; all 18 sitemap URLs use the production origin |
| Platform typecheck and lint | Passed on the final platform business code and prepared browser harness |
| Platform unit suite | 60 passed; 3 explicit external/integration opt-ins skipped |
| Billing including both real local PostgreSQL suites | 28 passed; Stripe sandbox opt-in skipped on this run |
| Store typecheck, unit tests and production build | Passed; 19 unit tests |
| Two isolated store HTTP/Mongo integration | 19 passed |
| Real platform + store + local PostgreSQL/Mongo | 10 passed |
| Owner/provisioning repository integration | 19 passed, including recovery-checkout cleanup protection |
| Provisioning/bootstrap/build-helper Node tests | 44 passed, including explicit API-key/verified-VM-ADC credential selection; the revised packaging suite subsequently passed all 3 checks, including a new real Linux GNU tar/installer regression |
| Bootstrap install/rollback filesystem tests | 8 passed |
| Platform browser suite | 49 passed with zero retries; real HTTP/browser route preparation completed first with zero browser errors; prior failed runs retained |
| Account deletion through real local HTTP/PostgreSQL | 10 passed: eight early rejections, intact credentials/sessions/billing and working login; exact fixtures cleaned |
| Tablet store browser flow | 7 passed on Chromium touch 1024×768 after visible input-field fix; local real queue/disk, AI disabled |
| Linux x86_64/glibc store artifact | Passed on Ubuntu 22.04/x86_64/Node 24.18.0/glibc 2.35: typecheck, all 19 store tests, production build, checksum/native inspection and the actual installer's archive guard |

The earlier real Stripe TEST run completed four hosted test-card payments with
test clocks, covering USD first-month bonus and annual conversion, CAD first-year
bonus and monthly conversion, cancellation overriding a scheduled change, normal
renewal, failed renewal, seven-day grace, suspension and recovery without arrears.
The original test webhook was restored and independently checked. Temporary
customers/clocks were removed and temporary products/prices archived. Those
archived prices are not deployment configuration. Capacity and cleanup changes
were subsequently verified locally without repeating the external sandbox run.

Local report locations (not part of a release artifact):

- `/tmp/whataisle-release-final-build.log`
- `/tmp/whataisle-release-final-typecheck.log`
- `/tmp/whataisle-release-final-lint.log`
- `/tmp/whataisle-release-root-unit.log`
- `/tmp/whataisle-release-root-e2e.log`
- `/tmp/whataisle-release-public-recheck.log`
- `/tmp/whataisle-release-prepared-e2e.log` (final 49 passed, zero retries; preparation is not counted as a test)
- `output/playwright/e2e-prepare-1788842894923/report.json` (route preparation ready, zero browser errors; restricted local report)
- `/tmp/whataisle-release-combined.log`
- `/tmp/whataisle-release-onboarding.log`
- `/tmp/whataisle-release-worker-unit.log`
- `/var/folders/_6/x8g9p9ys5hj_8_0vj02pjbyh0000gn/T/whataisle-store-helper-final-20260908-qr7u8ga6.log` (final 44 Node helper checks)
- `/tmp/whataisle-release-bootstrap-python.log`
- `/var/folders/_6/x8g9p9ys5hj_8_0vj02pjbyh0000gn/T/whataisle-auth-deletion-AQuAW2/result.json` (local restricted report; API exit 0, server stopped, configuration restored)
- `output/playwright/store-tablet-yx53YJ/report.json` (7 checks; accompanying tablet screenshots reviewed)
- `/tmp/whataisle-release-linux-build-final.log` (successful final Linux build)
- `/tmp/whataisle-release-linux-archive-final.json` (actual installer pre-extraction guard, accepted)

The prepared store runtime is built from commit
`8ae15a26e6a0915809a98322fbe65d880db13bd6`. Its archive is
`/Users/mystery/Desktop/dev/whataisle-store-linux-8ae15a26e6a0915809a98322fbe65d880db13bd6/build/store-8ae15a26e6a0915809a98322fbe65d880db13bd6.tgz`
(406,026,355 bytes), SHA-256
`880468203852ed064c6ce12c1a4e65da9af84f5406f492dba432114bb3e7850d`.
The adjacent `artifact-verification.json` records the matching source/runtime
manifest, all 19 native modules as Linux x86_64 ELF, all required runtime files,
zero embedded environment files and zero archive hardlinks. The installer
remains strict: native build hardlinks are expanded to regular files at packing
time, while internal npm symlinks are preserved. The earlier rejected archive
and its failure report are retained; only its redundant extracted build tree
was removed after verifying the archived copy.

The build reports an existing broad file-tracing warning through the legacy
Cost Lab route. This artifact intentionally includes the full reviewed store
source and dependencies; it is not a minimal standalone bundle. No production
service, database, Atlas setting or live payment was changed by these builds.

All local synthetic customer/store fixtures were removed by their test harnesses;
the four pre-existing local demo stores remain. Registration and reset email
verification used local Mailpit. The owner's actual mailboxes have not yet been
used to register customer accounts.

## Remaining external acceptance

1. Atlas login, the intended project, Free tier and both READY/queryable indexes
   have been verified read-only. Free has only one unused Search/vector index;
   a new store needs two. Flex is the prepared minimum-capacity upgrade and
   requires separate recurring-cost and existing-store downtime approval. The
   User Managed service-account list is empty. Organization resource policies
   showed an empty state, and Billing Overview explicitly showed no payment
   method. The database IP list includes active `0.0.0.0/0`; authentication is
   still required, but network reachability should be narrowed to verified VM
   egress and required operator addresses under the reviewed deployment scope.
   Finish configuring restricted worker API access and the remaining billing
   details.
   The paid cluster upgrade requires a payment method; restricted worker access
   remains separately unconfigured.
   The existing WhereBear runtime currently authenticates with `atlasAdmin`.
   Before adding any store, prepare and authorize replacement with a new
   `readWrite` user restricted to the existing `wherebear` database; do not
   downgrade the existing operator credential in place. Verify the actual
   serving process uses the restricted role after restart. The current private
   daily backup covers PostgreSQL only: a MongoDB backup, separately saved
   Search definitions and an isolated restore check must precede the upgrade.
   Both definitions have now been captured privately from the visible Atlas
   JSON editors in `/Users/mystery/Desktop/dev/whataisle-atlas-review-20260908-d7jbzhoe`; no definition was
   changed. This preparation does not replace the pending database-content
   backup or its restore check.
2. Review exact account permissions, new-runtime AI credentials, test-only Stripe
   prices/email allowlist and a bounded AI test budget. Keep secrets out of chat,
   Git and release artifacts. No cluster upgrade or additional VM is implied.
3. Authorize the reviewed deployment/database/service changes on the existing
   shared VM. Preserve the current WhereBear process and release. Main deployment
   alone does not install the new store runtime or worker.
4. Exercise two disposable store accounts through real hosted domain/TLS,
   provisioning, password/map, one shelf-photo scan and successful shopper lookup,
   then failure/retry and isolation checks. Local fixtures do not substitute for
   real Atlas, systemd, Caddy or AI acceptance.

The production platform currently uses a Stripe TEST key. Switching to live
collection is a separate reviewed action; this candidate does not silently
switch mode or claim readiness to collect real customer subscriptions.
