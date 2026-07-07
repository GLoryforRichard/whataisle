# WhatAisle

An online "find the shelf" service for multilingual grocery stores.

Staff snap casual photos of shelves; the system grows a product-location memory
searchable in English and Chinese. Shoppers scan an in-store QR code, ask by
typing, speaking, or taking a photo — and get a shelf-level answer with a
highlighted floor map. Zero manual data entry, ever.

- Main site: `www.whataisle.com`
- Per-store page: `<store-handle>.whataisle.com`
- Deployment target: Google Cloud (not yet deployed; built and verified locally)

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
pnpm seed                 # two isolated demo stores (see below)
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

Two stores exist specifically so tenant isolation is testable from day one.

### AI (Gemini)

The AI pipeline (shelf vision, aliases, embeddings, voice/photo, answer
synthesis) runs against Gemini. Provide credentials one of two ways:

- **AI Studio:** set `GEMINI_API_KEY` (free tier).
- **Vertex (GCP):** `gcloud auth application-default login`, set
  `GOOGLE_CLOUD_PROJECT`.

**Offline / CI:** set `AI_STUB="true"` to run the entire pipeline with
deterministic stub recognition — no credentials, no quota. The stub exercises
all plumbing (scan → dedup → save → embeddings → search → answer tones); only
semantic-match quality (e.g. Chinese partials matching via vector similarity)
requires real Gemini.

## Testing

```bash
pnpm build        # type-check + production build
pnpm lint         # Biome
pnpm e2e          # Playwright acceptance suite (dedicated server on :3100)
```

The acceptance suite (26 tests) covers: auth + onboarding, public/protected page
health (EN/中 × light/dark), the staff PIN gate, shopper search (confident /
not-found / injection-deflected), and the **hard tenant-isolation criterion** —
a shopper on one store can never see another store's products.

## Architecture

- `src/proxy.ts` — host routing: apex/www → main site + `/admin` back office;
  `<handle>.<root>` → rewrites to `/store/<handle>/*` (bypasses locale
  middleware; store locale comes from the `NEXT_LOCALE` cookie).
- `src/app/[locale]/` — main site: marketing, auth, `/onboarding`, owner portal
  (`/manage/*`), platform back office (`/admin/*`).
- `src/app/store/[handle]/` — per-store subdomain: shopper search + staff area.
- `src/ai/` — Gemini pipeline (two-stage shelf vision, face blur, multilingual
  aliases, embeddings, voice/photo, hybrid search, answer-tone synthesis,
  guardrails, usage metering). Ported from the proven `wherebear` MVP.
- `src/data/` — tenant-scoped data access. **All store-table access binds
  `storeId` here** — the isolation boundary (requirements §5).
- `src/db/` — Drizzle schemas (`store.schema.ts`) and migrations.
- `src/storage/` — file storage; local-disk driver for dev, S3/GCS later.
- `src/mail/` — Resend (prod) + SMTP/Mailpit (dev).

Tenant isolation, the top acceptance criterion, is enforced in three layers:
the store is always resolved from the request host (never client input); all
tenant queries go through `src/data/*` with an injected `storeId`; and staff
cookies are host-only and bound to `(storeId, pinVersion)`.

## Deferred backlog

- **GCP deployment** — wildcard TLS for `*.whataisle.com`, GCS storage driver
  (behind the existing storage abstraction), budget caps + cost alerts. Nothing
  in the code is Vercel/AWS specific; drivers are already abstracted.
- **Staffed full-store onboarding** — booking, multi-scanner coverage board,
  acceptance report (§6).
- **Stripe billing activation** — the template's payment plumbing is retained
  but dormant; pricing/trial mechanics are defined separately (§3).
- **AI vendor commercial-terms verification** — confirm resale is permitted and
  store data isn't used for training before real store data flows (§10, the
  spec's number-one item).
- Template UI-library leftovers (data-table, unused primitives) remain to
  support the dormant billing/credits pages; `pnpm knip` lists them.
