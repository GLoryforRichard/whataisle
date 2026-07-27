# WhatAisle

An online "find the shelf" service for multilingual grocery stores.

Staff snap casual photos of shelves; the system grows a product-location memory
searchable in English and Chinese. Shoppers scan an in-store QR code, ask by
typing, speaking, or taking a photo — and get a shelf-level answer with a
highlighted floor map. Zero manual data entry, ever.

- Main site: `www.whataisle.com`
- Per-store page: `<store-handle>.whataisle.com`
- **Live in production** on Google Cloud (project `whataisle-prod`)

Built on [mksaas-template](https://mksaas.com) (imported at `7b295cd9`) —
Next.js 16, React 19, Better Auth, Drizzle + Postgres (pgvector), next-intl
(EN/中文), Tailwind 4, Playwright.

## Local development

```bash
docker compose up -d      # Postgres (pgvector) on :5433 + Mailpit on :1025/:8025
cp env.example .env       # then fill in secrets (see comments); generate the
                          # BETTER_AUTH_SECRET / STAFF_COOKIE_SECRET with
                          # `openssl rand -base64 32`
pnpm install
pnpm db:migrate           # applies schema + pgvector/pg_trgm extensions
pnpm seed                 # three isolated demo stores (see below)
pnpm dev                  # http://localhost:3000
```

- **Owner portal:** `http://localhost:3000` (register, or use a seeded owner)
- **Demo store (shopper):** `http://demo.localhost:3000`
- **Staff area:** `http://demo.localhost:3000/staff` — PIN `1234`
- **Emails** (verification, closure notice): `http://localhost:8025`

### Seeded demo data (`pnpm seed`)

| Store | Subdomain | Owner login | Staff PIN |
|-------|-----------|-------------|-----------|
| Demo Market | `demo.localhost:3000` | `demo-owner@example.test` / `Demo12345678!` | `1234` |
| Second Mart | `mart2.localhost:3000` | `mart2-owner@example.test` / `Demo12345678!` | `5678` |
| Test Store | `teststore.localhost:3000` | `owner@example.test` / `Demo12345678!` | `9999` |

Multiple stores exist specifically so tenant isolation is testable from day
one; Test Store additionally ships a published floor map.

## AI: two providers, split by job

**Shelf detection — OpenRouter.** The rows-hd scan pipeline (`src/ai/scan/`)
runs `google/gemini-3.5-flash`, with `google/gemini-3.5-flash-lite` as the
cheap gate on the landing-page try-out. Set `OPENROUTER_API_KEY`; model ids and
tunables live in `src/ai/scan/config.ts` and are overridable via `OPENROUTER_*`.

**Everything else — Qwen via DashScope International (Singapore).** Aliases,
embeddings, voice transcription, find-by-photo, hybrid search, and answer
synthesis. Set `DASHSCOPE_API_KEY` from the Alibaba Cloud Model Studio console.
Defaults in `src/ai/models.ts` (`qwen3.5-flash`, `qwen3-vl-plus`,
`qwen3-asr-flash`, `text-embedding-v4`), overridable via `QWEN_*`.

**Cost accounting.** Every call is metered into `ai_usage_log`. OpenRouter
reports a real billed `usage.cost` per call and it is stored verbatim in
`cost_usd`; DashScope models have no per-call cost, so they are estimated from
the published price table. A NULL `cost_usd` means "not metered" and is
deliberately distinct from a real $0. `/admin/costs` breaks the month down per
store, showing metered and estimated separately.

**Offline / CI:** set `AI_STUB="true"` to run the entire pipeline with
deterministic stub recognition — no credentials, no quota, for *both*
providers. The stub exercises all plumbing (scan → dedup → save → embeddings →
search → answer tones); only semantic-match quality (e.g. Chinese partials
matching via vector similarity) requires real AI. Note the stub short-circuits
the scan engine entirely, so it never exercises real detection or cost metering.

**After changing the embedding model** (or restoring old data), run
`POST /api/admin/re-embed` — vectors from different embedding models live in
different spaces and must be regenerated together. Accepts either an admin
session or an `Authorization: Bearer $ADMIN_TASK_TOKEN` header for deploy
automation. It is a single-request full pass, so a large catalog can exceed
`maxDuration`.

## Testing

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # Biome, read-only (pnpm lint:fix applies changes)
pnpm build        # production build
pnpm test:unit    # node:test unit suites
pnpm e2e          # Playwright acceptance suite (dedicated server on :3100)
```

The acceptance suite (25 tests across 7 specs) covers: auth + onboarding,
public/protected page health (EN/中, light-only — dark mode was removed), the
staff PIN gate, shopper search (confident / not-found / injection-deflected),
the $999 purchase funnel and paywall, and the **hard tenant-isolation
criterion** — a shopper on one store can never see another store's products.

## Architecture

- `src/proxy.ts` — host routing: apex → canonical `www` (308); `<handle>.<root>`
  → rewrites to `/store/<handle>/*` (bypasses locale middleware; store locale
  comes from the `NEXT_LOCALE` cookie); `/admin` back office on the main host.
- `src/app/[locale]/` — main site: marketing, auth, `/onboarding`, owner portal
  (`/manage/*`), platform back office (`/admin/*`).
- `src/app/store/[handle]/` — per-store subdomain: shopper search + staff area.
- `src/ai/` — AI layer: the OpenRouter scan engine in `src/ai/scan/` plus the
  Qwen/DashScope client for aliases, embeddings, voice/photo, hybrid search,
  answer-tone synthesis, guardrails, and usage metering.
- `src/data/` — tenant-scoped data access. **All store-table access binds
  `storeId` here** — the isolation boundary (requirements §5).
- `src/db/` — Drizzle schemas (`store.schema.ts`) and migrations.
- `src/storage/` — pluggable file storage: `local` for dev, `gcs` in
  production, `s3` also implemented.
- `src/mail/` — Resend (prod) + SMTP/Mailpit (dev and CI).

Tenant isolation, the top acceptance criterion, is enforced in three layers:
the store is always resolved from the request host (never client input); all
tenant queries go through `src/data/*` with an injected `storeId`; and staff
cookies are host-only and bound to `(storeId, pinVersion)`.

## Deployment

Cloud Run + Cloud SQL behind a global load balancer with wildcard TLS for
`*.whataisle.com`. Every push to `main` triggers
`.github/workflows/deploy.yml` (keyless via Workload Identity Federation),
which builds the app and migration images, runs the migration job, then
deploys. One-time provisioning scripts live in `infra/gcp/`.

## Open items

- **AI vendor commercial-terms verification** — confirm resale is permitted and
  store data isn't used for training before real store data flows. Now covers
  two vendors (DashScope and OpenRouter). The spec's number-one item (§10).
- **Staffed full-store onboarding** (§6) — booking, multi-scanner coverage
  board, and acceptance report are still unbuilt. The admin mapping queue
  (`/admin/mapping`, `mapping_ticket`) covers the drawing half.
- **Budget caps and cost alerts** on the GCP project.
- **Subscriptions and credit packages** — the template's plumbing is retained
  but dormant; only the single $999 one-time plan is live.
- Template UI-library leftovers (data-table, unused primitives) remain to
  support the dormant billing/credits pages; `pnpm knip` lists them.
