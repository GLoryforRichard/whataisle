# WhatAisle

An online "find the shelf" service for multilingual grocery stores.

Staff snap casual photos of shelves; the system grows a product-location memory
searchable in English and Chinese. Shoppers scan an in-store QR code, ask by
typing, speaking, or taking a photo — and get a shelf-level answer with a
highlighted floor map.

- Main site: `www.whataisle.com`
- Per-store page: `<store-handle>.whataisle.com`
- Deployment target: Google Cloud (not yet deployed; local-first build)

Built on [mksaas-template](https://mksaas.com) (imported at `7b295cd9`) —
Next.js 16, React 19, Better Auth, Drizzle + Postgres (pgvector), next-intl
(EN/中文), Tailwind 4, Playwright.

## Local development

```bash
docker compose up -d      # Postgres (pgvector) on :5432 + Mailpit on :1025/:8025
cp env.example .env       # then fill in secrets (see comments)
pnpm install
pnpm db:migrate
pnpm seed                 # demo stores
pnpm dev                  # http://localhost:3000
```

- Owner portal: `http://localhost:3000`
- Demo store (after Phase 1): `http://demo.localhost:3000`
- Emails land in Mailpit: `http://localhost:8025`
- AI (Gemini): set `GEMINI_API_KEY` (AI Studio) or authenticate ADC with
  `gcloud auth application-default login` for Vertex.

## Structure

- `src/app/[locale]/` — main site: marketing, auth, owner portal, `/admin` back office
- `src/app/store/[handle]/` — per-store subdomain: shopper search + staff area
- `src/ai/` — Gemini pipeline (vision shelf-scan, aliases, embeddings, search)
- `src/data/` — tenant-scoped data access (all store data goes through here)
- `src/db/` — Drizzle schemas and migrations

## Deferred backlog

- POS CSV bulk import (products land "unlocated", auto-match on scan)
- Staffed full-store onboarding productization (booking, coverage board, acceptance report)
- GCP deployment (wildcard TLS for `*.whataisle.com`, GCS storage driver, Cloud Scheduler cron, budget alerts)
- Stripe billing activation (pricing defined separately)
