# WhereBear — WhatAisle customer 1

Imported without changing the search, scan, save, map, voice, image recognition,
feedback, or product-management implementations from WhereBear commit
`aff88a006459233ca101697c78f0a5c282c48ad3`.

This directory is the maintained store application inside the WhatAisle
repository. The root application remains the marketing, billing, and platform
admin application. Each application retains its original dependency lockfile.
Do not deploy this long-running worker into the website's Cloud Run container.

- Canonical URL: `https://wherebear.whataisle.com`
- Legacy origins: `https://wherebear.help`, `https://www.wherebear.help`
- Store registry: `../../stores/registry.json`
- Platform admin: `/admin/stores` (real administrator session required)
- Runtime: existing `wherebear-vm`, project `wherebear-prod-20260902`, Toronto
- Database: existing Atlas `wherebear`; no collection renaming or re-embedding
- Secrets: existing VM `.env.local`; never copy credentials into this repository

## Development and validation

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` here.
Root shortcuts are `pnpm store:dev`, `pnpm store:test`, `pnpm store:typecheck`,
and `pnpm store:build`. Root `pnpm build` builds only the website.

Set `WHEREBEAR_BACKGROUND_DISABLED=1` for preview/build verification against an
existing database. This disables background warmup and scan workers; it does
not stub AI endpoints. Never run a second worker on another machine against
production `scan_jobs`, because source photos/results are on the existing VM.

`WHEREBEAR_DOMAIN_CUTOVER=1` enables legacy domain migration. Keep it unset until
the new domain resolves to the VM, HTTPS succeeds, and the new host is verified.
An ordinary non-HTML request to an old page receives a 308 retaining the path
and query. Browser documents first inspect their old-origin IndexedDB queue:
empty queues redirect automatically; pending/failed photos stay on the old
origin until saved or explicitly handled by staff. Old API calls keep working
for open tabs. No queued photo is deleted by the domain migration. The old
origins and certificates must remain available for dormant devices to return.
Microphone/camera permissions and staff unlock are browser-origin-specific;
browsers may request them again at the new address.

See `../../docs/WHEREBEAR-MERGE.md` for release, data boundaries, and rollback.
