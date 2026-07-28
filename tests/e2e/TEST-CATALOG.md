# E2E Test Catalog

This catalog is the acceptance checklist for Playwright E2E coverage. Update it
before or alongside feature work, then use the implemented spec files to lock in
the verified behavior.

## Workflow

Use the local feature flow:

```txt
Spec -> Code -> Verify -> Test -> Green
```

1. Spec: add or update the relevant journey in this catalog.
2. Code: implement the feature.
3. Verify: run the app and walk the real UI in a browser.
4. Test: add or update the matching Playwright spec.
5. Green: run the related spec locally; run full E2E before releases or large
   refactors.

Pull-request CI runs the read-only Biome check, TypeScript check, and production
build. The `Release E2E` workflow runs manually and for published releases with
a dedicated PostgreSQL/pgvector service, migrated and seeded tenants, Chromium,
and `AI_STUB=true` so it never calls a paid AI provider.

## Test Harness

- Config: `playwright.config.ts`
- Specs: `tests/e2e/specs/`
- Fixtures: `tests/e2e/fixtures/`
- Test-only API: `src/app/api/e2e/users/route.ts`

For a deterministic local run, start PostgreSQL and apply the same preparation
used by release CI:

```bash
docker compose up -d db
pnpm db:migrate
pnpm seed
AI_STUB=true pnpm e2e
```

The test-only API is disabled unless Next.js is running locally in development
with `E2E_TEST_SECRET=mksaas-e2e-secret` and the request includes the configured
`x-e2e-secret` header. Test accounts must use the `e2e-*@example.test` email
pattern so cleanup stays scoped.

## 1. Public Page Smoke Test

**File:** `specs/public-pages.spec.ts` | **Priority:** P0

Verifies that public pages render in English/Chinese (light mode; dark mode removed) without
browser console errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Public pages render successfully | Open `/`, `/pricing`, `/about`, `/contact`, `/cookie`, `/privacy`, `/terms`, `/auth/login`, `/auth/register`, `/auth/forgot-password`, and `/auth/reset-password` for `en` and `zh` (light mode; dark mode removed). Verify each returns 2xx, renders a visible body, applies the requested theme, and emits no browser errors. |
| 2 | Home login modal opens | Open `/`, click the navbar login button, verify the login dialog and credential inputs are visible, and assert no browser errors. |
| 3 | Health check responds with pong | Call `/api/ping` and verify `{ "message": "pong" }`. |
| 4 | Chinese browsers land on Chinese | With a `zh-CN` browser context, open `/`; require a redirect to `/zh` and `html[lang="zh"]`. Locale resolution order is URL prefix → NEXT_LOCALE cookie → Accept-Language (`localeDetection: true` in `src/i18n/routing.ts`). |
| 5 | English browsers stay on English | With the default (en-US) context, open `/`; require the URL to stay `/` and `html[lang="en"]`. Regression guard: search bots must keep receiving the English page at the bare domain. |
| 6 | A manual language choice is remembered | From `/`, click the navbar 中文 switcher; require `/zh`. Open `/` again in the same context; require the NEXT_LOCALE cookie to redirect back to `/zh`. |
| 7 | Homepage links to the demo store | Open `/`; require the hero "Visit the demo store" link to point at the `demo.localhost` subdomain (`websiteConfig.demoStoreHandle` + `getStoreUrl()`; the seeded `demo` tenant serves it locally). |

## 2. Authentication And Protected Routes

**File:** `specs/auth.spec.ts` | **Priority:** P0

Verifies login and route protection with real Better Auth endpoints and seeded
verified users.

| # | Test name | Flow |
|---|---|---|
| 1 | Guests are redirected from dashboard | Open `/dashboard` while signed out, expect redirect to `/auth/login`, and verify the email input is visible. |
| 2 | Verified user can sign in | Create an E2E user, mark it verified, sign in through `/auth/login`, and verify dashboard content. |
| 3 | User can register from UI | Fill `/auth/register`, verify the registration success message, mark the test account verified, sign in through `/auth/login`, and verify dashboard content. |
| 4 | Signed-in user can view demo users dashboard | Sign in as a user, open `/admin/users`, and verify the demo users page renders. |

## 3. Protected Page Smoke Test

**File:** `specs/protected-pages.spec.ts` | **Priority:** P0

Verifies authenticated app pages render in English/Chinese (light mode; dark mode removed)
without browser console errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Protected pages render successfully | Sign in as an owner E2E user, then open `/dashboard`, the shelves, insights, profile, posters, and data management pages, the tenants/costs/users admin pages, and profile/security settings for `en` and `zh`. Verify each returns 2xx, renders a visible body, remains light-only, and emits no browser errors. |

## 4. Profile Settings

**File:** `specs/settings-profile.spec.ts` | **Priority:** P1

Verifies the signed-in profile update flow.

| # | Test name | Flow |
|---|---|---|
| 1 | User can update display name | Sign in, open `/settings/profile`, change the name, save, verify success toast, and reload to verify persistence. |

## 5. Shopper Search And Isolation

**File:** `specs/shopper-search.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Scanned product is found | Search the seeded demo store for Gochujang and require a confident result. |
| 2 | Unrelated query is not found | Search for deterministic nonsense and require no candidates. |
| 3 | Prompt injection is deflected | Submit an instruction-override query and require a deflection with no products leaked. |
| 4 | Product results are tenant-isolated | Search the empty second tenant for a demo-store product and require no cross-store candidate. |

## 6. Store Routing And Staff PIN Isolation

**File:** `specs/tenancy.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Known stores render their own brands | Resolve both seeded store subdomains and verify each tenant's branding. |
| 2 | Unknown and reserved hosts fail closed | Require the store-not-found page for an unknown handle and reserved `admin` subdomain. |
| 3 | Staff PIN accepts and rejects correctly | Accept the demo store PIN and reject an incorrect PIN. |
| 4 | Staff sessions are host-isolated | Authenticate on the demo store and verify the cookie cannot unlock the second store. |
| 5 | Forged store header cannot unlock another store | POST demo's PIN to mart2's host with `x-store-handle: demo`; require 401. |
| 6 | Forged store header cannot read another store's products | Search mart2's host for a demo product with `x-store-handle: demo`; require no leak. |
| 7 | Forged store header cannot revive an unknown host | POST to an unknown store host with `x-store-handle: demo`; require 404. |

Tests 5–7 are the regression for a fixed bypass: tenant identity was taken from
an inbound `x-store-handle` header in preference to the Host, and the proxy
matcher excludes `/api`, so the header was forgeable on every store API route.
The Host-based cases above all passed while the bug was live — only a request
that actually sends the header catches it.

## 7. Purchase Funnel And Paywall

**File:** `specs/paywall.spec.ts` | **Priority:** P0

The paywall sits between store creation and video upload: one $999 one-time
plan (`lifetime`). Specs seed entitlement through the e2e users API
(`hasPaid: true` inserts a completed lifetime payment row) — the hosted Stripe
Checkout itself stays out of E2E.

| # | Test name | Flow |
|---|---|---|
| 1 | Pricing shows the single one-time plan | Open `/pricing`, verify the $999 card renders and no subscription pricing appears. |
| 2 | Unpaid owner is walled off | Register + create store, open `/manage/video`, expect redirect to `/onboarding/payment` with the $999 offer; POST `/api/owner/video/init` and require 402 `payment_required`. |
| 3 | Paid owner reaches guided upload | Seed `hasPaid`, open `/onboarding/payment`, expect redirect to `/manage/video` with the filming checklist; `/api/owner/video/init` succeeds. |

## 8. Resumable Video Upload

**File:** `specs/video-upload.spec.ts` | **Priority:** P1

| # | Test name | Flow |
|---|---|---|
| 1 | A re-sent chunk is idempotent and the upload still completes | Init a 3-chunk upload, send chunks 0 and 2, re-send 0 and require the received count stays 2, require `/complete` fails while chunk 1 is missing, then send it and complete. |

## 9. Store File Access Control

**File:** `specs/storage-acl.spec.ts` | **Priority:** P0

Provider-agnostic: `isStoreStorageKey()` and the staff/thumbnail/video split
live in the route, so the local storage driver exercises them exactly. All
negative cases, so no fixture files are needed.

| # | Test name | Flow |
|---|---|---|
| 1 | A key belonging to another store is refused | Well-formed key, wrong tenant; require 404. |
| 2 | Path traversal out of the store prefix is refused | `stores/../../etc/passwd`; require 4xx. |
| 3 | Walkthrough videos are never served | Videos are platform-internal (§10); require 404 even on the owning store. |
| 4 | Non-thumbnail store files require a staff session | Anonymous shelf-photo fetch; require 403/404. |

## 10. Stripe Webhook Signature

**File:** `specs/stripe-webhook.spec.ts` | **Priority:** P0

The only path that grants paid entitlement, unauthenticated by necessity — the
signature is the guard. Note the route answers 200 to processing failures on
purpose (Stripe retries 4xx/5xx for three days), so "rejected" is read from the
body, not the status.

| # | Test name | Flow |
|---|---|---|
| 1 | A request with no signature is rejected outright | POST a forged `checkout.session.completed` with no signature header; require 400. |
| 2 | A forged signature is not processed | Shape-correct but wrong signature; require 200 with `Webhook handler failed`. |

## 11. Store Closure

**File:** `specs/store-closure.spec.ts` | **Priority:** P1

Closure means immediate deletion, no retention (§7). Registers throwaway
owners — it destroys its own tenant.

| # | Test name | Flow |
|---|---|---|
| 1 | A mistyped store name does not delete the store | Type a wrong name; require the close button stays disabled and the store still resolves. |
| 2 | The exact store name deletes the store and frees its subdomain | Type the exact name, confirm twice, then require the subdomain renders store-not-found and the owner is bounced to `/onboarding/handle`. |


The current eleven specs expand to 41 Playwright tests across the locale matrices.

## Deferred Coverage

These flows should be added after their dependencies are made deterministic:

| Area | Reason |
|---|---|
| Hosted Stripe Checkout and portal UI | Automating a third-party origin with its own CAPTCHA and unstable DOM. Reclassified as permanently manual rather than deferred. Signature enforcement is covered by `stripe-webhook.spec.ts`; entitlement by `paywall.spec.ts`. The webhook *happy path* stays out because the handlers behind `constructEvent` call the Stripe API, so it needs network or a mocked client. |
| Video upload completion email | Requires a fake mail provider or Mailpit assertions; verified manually (notification to the ops inbox with signed link). |
| GCS-specific resumable/signed-URL behavior | Needs fake-gcs-server, whose V4 signing and resumable semantics diverge from real GCS — it would buy less confidence than it costs. Cross-store ACLs are now covered against the local driver in `storage-acl.spec.ts`. |
| Transactional email | Requires a fake mail provider or captured verification links. |
| Real-model golden set | Runs in staging on a schedule; PR and release E2E stay on the deterministic AI stub. At the measured $0.26/scan even a 20-photo set is ~$5 per run, so it must never enter PR CI. (The old wording said "Vertex" — the repo has used OpenRouter + DashScope since `76eefdc`.) |
| — | Invite onboarding no longer exists (invite-only signup removed). Video resume and store closure are now covered by `video-upload.spec.ts` and `store-closure.spec.ts`; neither needed the infrastructure this row assumed. |
