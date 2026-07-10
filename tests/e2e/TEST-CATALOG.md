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

The current six specs expand to 22 Playwright tests across the locale matrices.

## Deferred Coverage

These flows should be added after their dependencies are made deterministic:

| Area | Reason |
|---|---|
| Payment checkout and portal | Requires Stripe or Creem test fixtures, webhook simulation, and provider-specific env. |
| GCS uploads and cross-store ACLs | Requires deterministic private-bucket fixtures or a storage emulator. |
| Transactional email | Requires a fake mail provider or captured verification links. |
| Real Vertex AI golden set | Runs in staging on a schedule; pull-request and release E2E stay on the deterministic AI stub. |
| Invite onboarding, video resume, and store closure | Add after the persistent invite/job/upload flows land. |
