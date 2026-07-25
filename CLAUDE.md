# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository. It is kept deliberately identical to `AGENTS.md` from
"## What This Is" down, so any divergence between the two shows up as a diff.

## What This Is

WhatAisle — an online "find the shelf" service for multilingual grocery stores.

- **Staff** snap casual photos of shelves; AI turns them into a product-location
  memory. No manual data entry, ever.
- **Shoppers** scan an in-store QR code and ask by typing, speaking, or taking a
  photo, in English or 中文, and get a shelf-level answer plus a highlighted
  floor map.
- **Owners** manage shelves, read "what did shoppers fail to find" insights, and
  print QR posters.

Live in production at `www.whataisle.com` (GCP project `whataisle-prod`);
per-store subdomains are `<handle>.whataisle.com`. Every push to `main`
auto-deploys via `.github/workflows/deploy.yml`.

Built on [mksaas-template](https://mksaas.com). A fair amount of template
machinery is retained but dormant — see "Dormant Template Leftovers" before
assuming a feature is live.

**The requirements document is `docs/REQUIREMENTS.zh.md`** (English:
`docs/REQUIREMENTS.en.md`). Code comments throughout the repo cite it by
section as `§5`, `§6`, `§7`, `§10` — that is this file. Read the relevant
section before changing behavior it describes. It carries a sync note listing
the parts that have since been withdrawn.

## Development Commands

- `pnpm dev` — Next.js dev server on :3000
- `pnpm build` / `pnpm start` — production build / serve
- `pnpm build:analyze` — bundle analysis
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — Biome check, **read-only** (this is what CI runs)
- `pnpm lint:fix` — Biome check with `--write` (the actual fixer)
- `pnpm format` — Biome formatter
- `pnpm test:unit` — `node:test` unit suites in `tests/unit/`
- `pnpm e2e` / `pnpm e2e:ui` / `pnpm e2e:install` — Playwright
- `pnpm seed` — create the three local demo tenants (see E2E Testing)
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply pending migrations
- `pnpm db:push` — push schema directly (dev only)
- `pnpm db:studio` — Drizzle Studio GUI
- `pnpm content` — rebuild the fumadocs MDX collection (legal pages only)
- `pnpm email` — email template preview on :3333
- `pnpm knip` — unused exports/deps/files (expect many template false-positive
  hits; it cannot see through the generated `.source` barrel)
- `pnpm auth:schema:generate` — regenerate `src/db/auth.schema.ts`

Node is pinned to `>=24.18.0 <25` and pnpm to `10.33.2` via `engines`, enforced
strictly. Validate changes with `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## E2E Testing

- Config: `playwright.config.ts`; specs: `tests/e2e/specs/`; catalog:
  `tests/e2e/TEST-CATALOG.md`
- **25 tests across 7 specs**: public pages, auth + protected routes, profile
  settings, shopper search, store routing + staff PIN isolation, and the
  purchase funnel/paywall.
- Workflow: update the catalog first, implement and walk the real UI, then add
  or update the matching spec.
- Runs against a dedicated server on port `3100` using `.next-e2e`, so it can
  run alongside a normal `pnpm dev` on :3000.
- E2E mode sets `NEXT_PUBLIC_DEMO_WEBSITE=true`, `NEXT_PUBLIC_E2E_TEST_MODE=true`,
  `AI_STUB=true`, `NEXT_PUBLIC_PAYMENT_PROVIDER=stripe`,
  `NEXT_PUBLIC_STRIPE_PRICE_LIFETIME=price_e2e_lifetime`,
  `NEXT_PUBLIC_ROOT_DOMAIN=localhost`, and `E2E_TEST_SECRET`. It disables
  Turnstile and external side effects, and uses `/api/e2e/users` to
  clean/verify/entitle `e2e-*@example.test` accounts.
- Prepare a deterministic run with `docker compose up -d && pnpm db:migrate &&
  pnpm seed`. Seeded tenants (owner password `Demo12345678!`):
  `demo` (PIN 1234), `mart2` (PIN 5678), `teststore` (PIN 9999, ships a
  published floor map). Multiple stores exist so tenant isolation is testable.
- Run one spec with `pnpm exec playwright test tests/e2e/specs/auth.spec.ts`.
  If the dev server hangs at startup, `rm -rf .next-e2e` and retry.
- PR CI runs audit + lint + typecheck + build. `e2e.yml` is a separate
  manual/release workflow that provisions pgvector, migrates, and seeds.

## Architecture Overview

### Routing & Host Resolution

- **`src/proxy.ts`** is the entry point — a Next.js 16 Proxy (the renamed
  Middleware). There is no `src/middleware.ts`. It:
  1. 308-redirects the apex domain to the canonical `www` host, so auth API
     calls stay same-origin;
  2. rewrites `<handle>.<root-domain>/*` to `/store/<handle>/*`, bypassing the
     locale middleware entirely (store locale comes from the `NEXT_LOCALE`
     cookie);
  3. blocks direct `/store/*` access on the main host;
  4. applies cookie-only auth redirects, then `next-intl`.
- Main site lives under `src/app/[locale]/` with `next-intl`'s as-needed prefix
  strategy (default locale omitted from the URL). Route groups: `(marketing)`,
  `(protected)`, `auth`, plus `onboarding` and `terms-update`.
- Per-store subdomain app lives at `src/app/store/[handle]/` — **outside** the
  locale segment.
- API routes at `src/app/api/`, outside the locale segment.
- Translations: `messages/en.json`, `messages/zh.json`. Routing config:
  `src/i18n/routing.ts`.

### Tenancy & Isolation — the #1 acceptance criterion

A shopper seeing another store's shelf number is the worst-case failure, so
isolation is enforced in three layers:

1. The store is always resolved from the **request host**, never from client
   input (`src/lib/store-context.ts`).
2. **All tenant-table access goes through `src/data/*`.** Each repo is a closure
   binding `storeId` at construction, so callers cannot pass a store id per
   query and a forgotten `WHERE` cannot leak across tenants. Seven repos:
   `tenant-repo`, `product-repo`, `search-repo`, `insights-repo`,
   `mapping-repo`, `feedback-repo`, and `platform-repo` (the deliberate
   cross-tenant exception, admin-guarded only).
3. **Staff PIN sessions** are host-only. `src/lib/staff-auth.ts` issues a
   `wa_staff` HttpOnly cookie of `<storeId>.<pinVersion>.<expiresAt>.<hmac>`
   signed with `STAFF_COOKIE_SECRET`; bumping `store.pinVersion` revokes every
   session at once. PINs are scrypt-hashed (`src/lib/pin.ts`). Guard:
   `src/lib/require-staff.ts`.

### Authentication (Better Auth)

- Server config `src/lib/auth.ts`; client `src/lib/auth-client.ts`.
- PostgreSQL adapter via Drizzle. Session cookie cache 1 hour, 7-day expiry,
  freshness check disabled.
- Plugins: **`admin` and `emailHarmony` only**. `emailHarmony` is email
  normalization/dedup (blocks `+tag` and dot aliases); email verification and
  password reset are core `emailAndPassword`/`emailVerification` options, not
  plugins.
- OAuth: **Google only** (no GitHub), and only when
  `PUBLIC_GOOGLE_LOGIN_ENABLED=true` (or non-production) *and* both
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. Account linking is on with
  `trustedProviders: ['google']`.
- **Auth hooks gate signup on store invites**: `hooks.before` rejects
  `/sign-up/email` with `STORE_INVITE_REQUIRED` unless a valid invite token
  matches the email; `hooks.after` marks the invite accepted. Bypassed when
  `PUBLIC_SIGNUP_ENABLED=true`, which is the current production setting
  (`src/lib/store-invites.ts`).
- Auth tables live in `src/db/auth.schema.ts`; `src/db/schema.ts` is only a
  re-export barrel.

### Database (Drizzle ORM + PostgreSQL + pgvector)

- Connection `src/db/index.ts` using the `postgres` driver (not `pg`),
  singleton. It extracts and strips a `?host=` param before handing the DSN to
  postgres.js, so Cloud SQL unix sockets work.
- `src/db/schema.ts` re-exports three files:
  - `auth.schema.ts` — Better Auth tables
  - `app.schema.ts` — `payment`, `userCredit`, `creditTransaction`
  - **`store.schema.ts` — the 24 WhatAisle tables**: `store`, `shelf`,
    `floorMap`, `product`, `productAlias`, `productLocation`, `scanBatch`,
    `scanPhoto`, `searchLog`, `missInsight`, `feedbackReport`, `aiUsageLog`,
    `storeVideo`, `mappingTicket`, `reviewTask`, `auditLog`, `supportTicket`,
    `announcement`, `salesLead`, `storeInvite`, `backgroundJob`,
    `impersonationGrant`, `rateLimit`, `storeTermsAcceptance`.
- Every tenant table carries a NOT NULL `storeId` with cascade delete.
  Embeddings are `vector(768)`; `0009`/`0012` add the pgvector and pg_trgm
  extensions and indexes.
- Migrations in `src/db/migrations/`, mostly generated. Prefer `pnpm db:generate`
  over hand-writing so `meta/_journal.json` and the snapshot stay consistent.

### Server Actions (next-safe-action)

**Five** action clients in `src/lib/safe-action.ts`, each layered on the last:

- `actionClient` — base, no auth
- `userActionClient` — authenticated session in ctx
- `storeActionClient` — adds the caller's owned store
- `adminActionClient` — admin role required
- `demoReadonlyAdminActionClient` — admin, but blocks writes in demo mode

All actions validate input with Zod and live in `src/actions/` by feature.

### AI — two providers, split by job

`AI_STUB=true` forces deterministic offline stubs for **both** providers; the
E2E suite relies on this, which also means E2E never exercises real scan or
cost-metering paths.

**OpenRouter — shelf detection only** (`src/ai/scan/`, ported from
`whataisle-readshelf`). Model `google/gemini-3.5-flash`
(`google/gemini-3.5-flash-lite` for the landing pre-check gate), overridable via
`OPENROUTER_*`. Tunables in `src/ai/scan/config.ts`. The rows-hd pipeline:
row-band detection → HD band slices (3072px long side) → grid-stitched readout
of product names. Modules: `detect.ts`, `bands.ts`, `grid.ts`, `readout.ts`,
`box-parser.ts`, `image.ts` (EXIF/HEIC normalization), `names.ts`, `cost.ts`.
`bands`, `box-parser`, `grid`, and `cost` are the unit-tested pure modules.

**DashScope / Qwen — everything else** (`src/ai/`, OpenAI-compatible endpoint in
`client.ts`). `qwen3.5-flash` for answers and aliases, `qwen3-vl-plus` for
find-by-photo, `qwen3-asr-flash` for voice, `text-embedding-v4` for embeddings
(768-dim). Defaults in `src/ai/models.ts`, overridable via `QWEN_*`.
`search-pipeline.ts` is a fixed non-agentic understand → hybrid retrieve →
synthesize flow; `guardrails.ts` pre-filters the public shopper endpoint.

**Cost accounting** (`src/ai/usage.ts` → `ai_usage_log`): OpenRouter reports a
real billed `usage.cost` per call, stored in the nullable `cost_usd` column;
DashScope models are estimated from the published price table. NULL `cost_usd`
means "not metered", deliberately distinct from a real 0. `/admin/costs` shows
metered and estimated separately. After changing the embedding model, run
`POST /api/admin/re-embed` (admin session, or `ADMIN_TASK_TOKEN` bearer for
deploy automation) — vectors from different models are not comparable.

### Payment & the Purchase Funnel

- **One live product: a $999 one-time `lifetime` plan.** Free and Pro are
  `disabled: true` in `src/config/website.tsx` and hidden from the pricing UI.
- Funnel: public signup → `/onboarding/handle` (create store) →
  `/onboarding/payment` paywall → `/manage/video` guided walk-through upload →
  ops notification email with a signed GCS link → the platform draws the floor
  map in `/admin/mapping`.
- Entitlement is checked by `src/lib/premium-access.ts`; unpaid owners are
  redirected off `/manage/video` and `/api/owner/video/init` returns 402.
- Provider pattern in `src/payment/` registers **both Stripe and Creem**, chosen
  by `NEXT_PUBLIC_PAYMENT_PROVIDER`. Only Stripe is wired end-to-end — there is
  no Creem webhook route, so Creem would check out and never fulfil.
- The Stripe price id is a **build-time** variable
  (`NEXT_PUBLIC_STRIPE_PRICE_LIFETIME`), so changing it requires a redeploy.

### Owner Portal & Admin Back Office

- Owner (`src/app/[locale]/(protected)/manage/*`): `video`, `map`, `profile`,
  `shelves`, `insights`, `posters`, `data`.
- Admin (`.../admin/*`, founder-only, redirects non-admins): `users`, `tenants`,
  `onboarding`, `mapping/[id]`, `costs`, `tickets`, `announcements`, `audit`.
  Plus `/api/admin/{impersonate,re-embed,video}`.

### Other Providers (factory pattern)

- Storage `src/storage/` — **three** providers: `gcs`, `local`, `s3` (s3mini).
  Default `local`; production uses `gcs`. Tenant key namespacing in `keys.ts`,
  resumable video upload in `video.ts`, ACL-enforcing serving route at
  `/api/store/files/[...key]`.
- Mail `src/mail/` — `resend` (prod) and `smtp`/Mailpit (dev and CI), selected
  by `MAIL_PROVIDER`. React Email templates, all localized.
- Notifications `src/notification/` — Discord, Feishu.

### State & Data Flow

Server components fetch directly; mutations go through server actions. React
Query for client async data, Zustand for the little client state there is
(`src/stores/locale-store.ts`). Forms use React Hook Form + Zod.

### Content & Configuration

- `content/` holds **only** the legal pages (privacy, terms, cookie × EN/中文)
  as fumadocs MDX. The docs, blog, and changelog sections were removed from the
  product; `src/lib/source.ts` exposes just `pagesSource`.
- Centralized config with feature flags: `src/config/website.tsx`. Env template:
  `env.example`.
- Demo mode (`NEXT_PUBLIC_DEMO_WEBSITE`) enables Crisp chat, Turnstile, credits,
  and a looser admin check.
- **The product is light-mode only** — dark mode was removed and the theme
  switch is disabled.

## Dormant Template Leftovers

Present in the tree but **not live** — do not treat these as working features:

- **Credits** (`src/credits/`, `/settings/credits`): only enabled in demo mode.
  Still imported by the payment webhook path, so don't delete blindly.
- **Subscriptions and credit packages**: fully configured, `disabled: true`.
- **Creem payment provider**: registered, no webhook route.
- **`apikey` table** (`src/db/auth.schema.ts`): the plugin was removed; the
  table is retained deliberately so Better Auth schema regeneration stays
  non-destructive (see `scripts/auth-schema.config.ts`).
- **`src/components/data-table/` and many `src/components/ui/` primitives**:
  unused template UI. `pnpm knip` lists them.

## Code Style

- Biome enforces: 2-space indentation, 80-char line width, single quotes, ES5
  trailing commas, semicolons required
- Filenames: kebab-case (`dashboard-sidebar.tsx`); hooks prefixed `use-`
- Named exports preferred; default exports only for pages/layouts
- Server-only modules start with `import 'server-only'`
- Tailwind CSS v4 with tokens in `src/styles/`
- UI primitives from Radix UI; icons from `lucide-react`
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`
