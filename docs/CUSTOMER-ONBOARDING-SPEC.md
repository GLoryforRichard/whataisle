# Customer onboarding and subscriptions — accepted 2026-09-07, revised 2026-09-08

This specification records the owner's confirmed conversation decisions and
supersedes the historical manual-install, video-first and lifetime-payment
descriptions in `REQUIREMENTS.*` and `AGENTS.md` for this work. The two-stage
onboarding release `d2f5d76` was deployed on 2026-09-08 and its first Stripe TEST
store completed real map confirmation. This revision implements the later
same-day self-service/offline promotion policy below; verify its production
rollout separately from release evidence.
Existing customer data and confirmed service periods must be preserved.

WhatAisle is sold online as self-service software: owners create their store,
draw its map and manage shelf photos with staff. Public marketing, metadata and
terms must not promise founder visits, installation, map drawing, poster hanging
or other staffed setup. A founder may assist an offline customer using the same
tools, but that does not create a standard subscription service commitment.

## Purchase and store creation

1. Verified owner account signs in and pays before creating a store.
2. Paid owner enters display name, checks and explicitly confirms a permanent
   unique handle, then sets a six-digit numeric store workspace password.
3. Submission durably creates the empty store and queues provisioning. Retries,
   duplicate webhooks and repeated clicks cannot charge twice or create twice.
4. Provision one process per store on the approved shared VM, with restricted
   Mongo credentials/database and distinct files/queue. This first stage creates
   only ordinary database structures; Search/vector index creation must not
   block the public drawing URL or trigger embedding usage. Never copy WhereBear
   products, photos, map or secrets. WhereBear remains customer 1.
   Reserve capacity before opening Checkout: five stores total, including
   WhereBear, paid owners awaiting setup, retained stores and pending checkouts.
   Concurrent customers cannot oversell the last place. Existing-store recovery
   reuses its place; confirmed checkout expiry or completed archive releases it.
5. The public store URL initially opens a full-screen tablet map editor. Drafts
   remain on the current device, never anonymously written to a server.
6. Final confirmation checks the store password on the server and atomically
   saves the map and stable shelf identities in the store's isolated database.
   This confirmation is durable across browser closure and devices; it is not
   only a local draft. The same URL then shows that the store is being prepared
   until search activation completes. No map or shelf recreation is required.
7. When additional Search/vector capacity is needed, an explicitly authorized
   Atlas upgrade can provide it. Upgrade costs are not triggered by payment,
   map confirmation or a provisioning retry. The founder separately requests
   search activation in the platform back office. The worker uses the existing
   store identity, verifies its confirmed map and both ready/queryable search
   indexes, and completes activation without rotating credentials or restarting
   the store. Only then do public product search and staff photo upload open.
   Founder and staff use the same password-protected workspace to select shelves
   and take/upload photos. Every protected API enforces authorization itself;
   hiding buttons alone is insufficient. Scanning all shelves is not a further
   publish gate. A failed activation leaves the saved map intact and retryable.
8. Owner dashboard changes display name/password and opens map editing. Handle
   cannot change. Moving/renaming a shelf retains its product associations.
   Staff cannot edit an already-published map. Changing password invalidates all
   previously issued sessions. Rate-limit failed password attempts.

The 2026-09-08 revision deliberately separates mapping from search activation
so a new customer can pay and save a map before additional Atlas capacity is
purchased. Saving the small map/shelf document in
the existing free cluster avoids a second temporary store or a later map import.
Every store still has its own database credentials and files. This revision does
not change payment-date entitlement, the five-store capacity ceiling, or require
the founder's presence for subsequent staff uploads.

## Prices and entitlement

| Plan | Standard first service period | Later service periods |
| --- | --- | --- |
| USD monthly | US$199 / 1 calendar month | US$199 / month |
| INCAD monthly | CA$199 / 1 calendar month | CA$199 / month |
| USD annual | US$1,999 / 12 calendar months | US$1,999 / 12 months |
| INCAD annual | CA$1,999 / 12 calendar months | CA$1,999 / 12 months |
| 1CADTEST | CA$1 / month, no bonus | CA$1 / month |

Formal prices exclude applicable tax. Checkout displays currency, taxes, total
and next charge date. Service starts on the actual successful payment date.
Annual US$1,999 is a US$389 saving against twelve US$199 payments (US$2,388),
not an automatic extension beyond twelve months.

The offline offer `BONUS2` is explicitly applied before the first eligible
formal payment and adds two calendar months to that payment's service period:
monthly becomes three months, annual becomes fourteen. It can combine with
`INCAD` to keep the selected CAD price/currency while extending that first term.
`INCAD` alone changes currency/prices and never adds time. `1CADTEST` cannot
combine with `BONUS2` and always covers one month. An invalid, ineligible or
conflicting offer must be rejected clearly rather than silently removed.

No entered bonus offer means a standard one- or twelve-month first term. The
bonus is available only for the first successful formal payment, once per store
and its permanent owner billing ledger. A prior successful payment without the
offer also makes it ineligible: customers cannot claim it later by renewing,
switching plans, canceling/recovering or recreating an archived store. Persist
the applied offer and granted term with checkout/payment state; webhook retries
must not add months again. Existing checkout eligibility snapshots and already
confirmed paid/promotional periods from the earlier policy remain valid and
must not be shortened or recalculated. Bonus history survives ordinary
store-data cleanup. The code is resolved from server-only configuration; never
embed it in public site content, metadata, browser bundles or examples. The
public checkout can accept codes and display a valid offer's resulting term;
public terms say applicable offers follow checkout, without advertising the
offline code or specific extra months.

Test access is
allowlisted and limited to three successful subscription openings in total;
renewals do not consume quota. Failed/expired checkouts cannot burn quota.
No test-code expiry was requested. Never silently upgrade a test subscription
to a formal plan. Real test accounts are registered using the owner's existing
computer email accounts only after development and checks are complete.

Monthly/annual switches are scheduled at the current paid-plus-bonus period's
end, in the original currency, without immediate charging or a new bonus.
Cancellation prevents a pending switch from charging. Cancellation stops future
renewals and preserves all purchased and gifted time; refunds require manual
review and do not happen automatically on cancel/switch.

## Failure, suspension and cleanup

Failed renewal notifies the customer and permits seven days' full access. After
that, search and scanning stop, with a payment/recovery entry retained. Actual
suspended time creates no additional charges or arrears. Recovery starts a new
paid period on its payment date, without another bonus or suspended-time debt.

Retain store data for three calendar months from actual suspension/end of
service, not the cancellation request date. Then mark it pending cleanup in the
founder dashboard. Send no retention-expiry mail. Only the founder's explicit
confirmation queues cleanup; never automatically erase customer store data.
An open/reserved recovery checkout blocks cleanup until Stripe reconciliation
confirms expiry or payment, including when its local expiry time has passed.

## Account deletion

Automatic account deletion is unavailable in this release for every account,
including administrators and owners without a billing record. Hide the self
service delete control. A global auth before-hook rejects `/delete-user`,
`/delete-user/callback`, and `/admin/remove-user` before any credential or
session mutation, with instructions to cancel renewal on the billing page and
contact support about account deletion. Other administrator operations remain.

Better Auth 1.6.23 deletes sessions and accounts before deleting the user without
an enclosing transaction. The permanent billing ledger's restrictive user FK
alone cannot prevent loss of login credentials; a ledger-based preflight check
also races with a new checkout. Do not replace this unconditional guard with
either approach. This protection neither cancels Stripe subscriptions nor
deletes pending checkouts, entitlement, bonus history, or commercial records.
Any future account-deletion process needs an explicit separate design.

## Verification gates

- Root: `pnpm typecheck`, `pnpm lint`, `pnpm build`, relevant unit and E2E tests.
- Store: `pnpm store:typecheck`, `pnpm store:test`, `pnpm store:build`.
- Exercise actual UI signup, checkout return, recoverable setup, map drawing,
  password failure/success, map persistence before search activation, explicit
  founder activation, public search, staff uploads, owner edits and PIN
  revocation. Before activation, direct search/upload calls must reject without
  AI or queued-photo side effects; the same map/shelf IDs survive activation and
  retries. Two fresh stores must prove data and cookie isolation.
- Exercise standard first periods, explicit bonus alone/with INCAD, rejection
  with 1CADTEST, ineligible repeat/late use and preservation of historical
  checkout grants, renewals, both plan switches, cancel override,
  grace/suspend/recovery, quota concurrency and webhook retries/ordering with
  deterministic service tests, then Stripe sandbox/time-clock verification.
- Provisioning dry-run and failure-retry checks must not mutate production.
- Against an already running local platform, run
  `AUTH_DELETION_TEST_BASE_URL=http://localhost:<port> node --env-file=.env --import tsx scripts/auth-deletion-integration.mts`.
  This local-only HTTP/PostgreSQL check verifies ordinary and administrator
  deletion rejection, intact credentials/sessions/pending billing, and working
  subsequent sign-in. It starts no server and cleans only its own fixtures.
- Live Stripe charges, real email sending, deployment and production database
  changes remain distinct external actions; do not claim them tested from mocks.
