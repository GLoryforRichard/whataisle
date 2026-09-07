<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent orchestration — Google ADK is the canonical path

The "find the aisle" search agent runs on the **Google Agent Development Kit** (`@google/adk`), code-first path of Google Cloud Agent Builder. This is the compliant orchestration for the Rapid Agent Hackathon and the default at `/api/search`. The legacy hand-rolled pipeline is only kept behind `SEARCH_ENGINE=legacy` for one-line rollback during demos.

- ADK agent definition: `lib/agents/adk/search-agent.ts` — single `LlmAgent` with Vertex Gemini (`location:'global'`), three FunctionTools, and MongoDB MCP mounted as `MCPToolset` (stdio, reuses the same `mongodb-mcp-server@1.10.0` config as `lib/mcp/mongo-mcp.ts`).
- Tool params use **`@google/genai` Schema** (not zod) — ADK ships its own `zod@4` while the app uses `zod@3`, so a zod object built against the app's zod fails ADK's internal `instanceof` checks. genai Schema is a plain object and survives the version boundary.
- When mounting any new MCP server as a toolset, **narrow the tool allow-list**. A wide-open toolset lets the agent "browse the database" with `list-collections` / `find` instead of using domain tools like `vector_search`.
- `Runner.runEphemeral({ newMessage })` requires **`role: 'user'`** on the message. Without it Gemini drops the content and the agent replies "what are you looking for?".

Do NOT introduce LangChain, LangGraph, LlamaIndex, or any other third-party agent orchestrator — they are explicitly disallowed by the hackathon rules.

# Deployment — WhatAisle-managed GCP store runtime

Owner decision (2026-09-06): WhatAisle and its first five stores share the new
account's existing VM and GCP project. Consider splitting only after MVP
validation with more than five stores. Separate app processes do not imply
separate products or VMs. Preserve store-specific data credentials, queues,
and access boundaries. Cloud cutover completed: the platform uses systemd/3000,
local PostgreSQL/5432 and the same Caddy; WhereBear remains on PM2/3002.
Both old projects have billing disabled; never restart or deploy to them.
See `../../docs/MVP-SHARED-VM.md` for the migration and verification record.

This application is maintained at `apps/wherebear` in the WhatAisle repository.
It runs on the existing Google Compute Engine VM behind Caddy and PM2; do not
move the long-running scan worker into the website's Cloud Run container.

- Canonical live host: <https://wherebear.whataisle.com>
- Legacy hosts: `wherebear.help`, `www.wherebear.help`, retained for redirects
  and origin-local photo recovery. Never remove their HTTPS/API service.
- Project: `wherebear-prod-20260902`
- VM: `wherebear-vm`, zone `northamerica-northeast2-b`
- Current release: `/home/mystery/whataisle-releases/wherebear-20260905-final`
- Active PM2 process: `wherebear-platform-final`, loopback port 3002
- Retained rollback checkout: `/home/mystery/wherebear`; its `wherebear` PM2
  process is stopped. Do not deploy by pulling this old repository.
- Main-branch pushes deploy the root website automatically. Store releases
  require the separate VM procedure in `../../docs/WHEREBEAR-MERGE.md`.

Build and validate a separate release directory with
`WHEREBEAR_BACKGROUND_DISABLED=1`. Never build over the live `.next` directory,
run a second scan worker, or restart an active worker before draining its jobs.
Keep ADK/MCP, MongoDB search indexes, Gemini configuration, asynchronous worker,
and origin-local scan queue intact. Store secrets stay on the VM; no credentials
belong in the platform registry or website build.

The deployment, backup, validation and rollback record is
`../../docs/WHEREBEAR-MERGE.md`; store data ownership is described there and in
`../../stores/registry.json`. Both applications retain independent builds and
run on their existing GCP resources. This release registers customer 1 only;
future stores require isolated databases and restricted credentials.
