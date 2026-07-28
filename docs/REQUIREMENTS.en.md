# WhatAisle — Requirements: An Online "Find the Shelf" Service for Multilingual Grocery Stores

> A subscription service sold online to a range of different grocery stores: staff snap casual photos of shelves, and the system grows a product-location memory searchable in both English and Chinese; shoppers scan an in-store QR code and ask by typing, speaking, or taking a photo — and get a shelf-level answer with a highlighted floor map.
>
> Main site: `www.whataisle.com` · Per-store page: `<store-handle>.whataisle.com` · Deployment: Google Cloud

> **⚠️ Sync note (added 2026-07-25 — not part of the original requirements)**
>
> This is WhatAisle's authoritative requirements document. It previously lived only outside
> this repo, which left the seven `§N` comments in the code with nothing to point at. It is
> now version-controlled here.
>
> **Withdrawn (owner's decision, 2026-07-25 — will not be built):** the
> **staffed full-store onboarding service** in §3 and §6 (booking and scheduling,
> simultaneous multi-person scanning, whole-store coverage board, acceptance report).
> There is no on-site onboarding service. Both bullets are struck through below.
>
> **One clarification:** §6's "drawing the map must never block the first photograph — the
> customer must be able to shoot their first shelf and find it on the shopper side on signup
> day" refers to the **free pre-payment trial scan on the landing page** (`/api/try-scan`,
> already shipped). The actual paid-store flow is: order → upload a store walkthrough video →
> the platform draws the map and creates the shelf list → **the platform unlocks scanning** →
> the customer starts scanning shelves.

---

## 0. Guiding Principle (overrides every specific requirement below)

**Our users are the owners and staff of neighborhood grocery stores — generally not highly educated, with very little patience for software. Whenever "useful" and "simple" conflict, choose simple. Every screen and every flow must pass one test: "Can a fifty-year-old clerk who isn't good with phones figure this out without being taught?" If a feature can't pass that test, we'd rather not build it.**

---

## 1. Background and Pain Point

Our target customers are neighborhood grocery stores with linguistically diverse shoppers (Chinese supermarkets, Korean grocers, Latin American markets, and the like). "Where can I find X?" is the question staff get asked most, every single day — shoppers may ask in Chinese or English, misspell brand names, or only be able to describe what the thing looks like ("the black paper for sushi").

Product-location knowledge lives only in the heads of veteran employees: new hires can't answer, and experienced staff get interrupted constantly. And **no store has the time or willingness to manually enter and maintain a product database** — any solution that requires entering SKUs, labeling items, or maintaining a database is doomed in this segment. Treat that as a hard design constraint.

---

## 2. Core Product Concept

A **"store memory that grows by itself"**:

- Staff snap a few photos whenever they happen to walk past a shelf; the system automatically recognizes the products, automatically generates multiple names for each one (English, Chinese, pinyin/romanization, common misspellings), and records "which product is on which shelf";
- The more times a product is photographed, the more trusted its memory becomes;
- From then on, shoppers can search any way they like and get an "it's on shelf N" answer with a map highlight.

**The more you snap, the better the search; zero manual data entry, always.**

---

## 3. Business Shape

- A **subscription service sold online** to a range of different grocery stores: an owner signs up on our website and gets going on their own.
- **One account maps to one store.** No multi-store/chain architecture (a chain owner who wants a second store simply registers a second account; we'll revisit if the need becomes real).
- Pricing, billing, and any free-trial mechanics will be defined separately. They are out of scope for this document.
- **[ADDED 2026-07-28] The marketing site links to a real demo store** (`demo.whataisle.com`, a platform-operated tenant): before paying, an owner can search products and see the map exactly as a shopper would. The homepage secondary CTA, the QR band, and the footer all point at it; configured via `websiteConfig.demoStoreHandle`, and every entry point hides when it is unset.
- ~~We offer a **staffed full-store onboarding service** (our people walk the store's team through photographing the whole store in a few hours) as an optional paid add-on.~~ **[WITHDRAWN 2026-07-25: there is no on-site onboarding service]**

---

## 4. The Product Itself

### 4.1 Shopper side (public, no login, no install)

**Entry point and store URL**

- The main site lives at `www.whataisle.com`. When a store signs up, the owner picks a store handle (e.g., `xxyyzz`), and that store's shopper page becomes **`xxyyzz.whataisle.com`**.
- Handle rules: letters, digits, and hyphens only; unique across the platform; reserved words (`www` / `admin` / `api` / `help` / `app`, etc.) cannot be registered; availability is validated in real time at signup; there must be an anti-impersonation mechanism (you can't register another well-known store's name to trade on its reputation — the platform can arbitrate and reclaim a handle if abuse is found).
- **Once chosen, the subdomain can never be changed.** The selection screen must spell out the consequence in one sentence ("This will be the permanent web address shoppers use for your store. It will be printed on your posters — choose carefully.") and show a preview (`xxyyzz.whataisle.com`) with a second confirmation. The store's display name can be changed at any time without affecting the URL; if the store changes hands, the URL stays with the store.
- The system generates print-ready **in-store posters, checkout-counter stands, and shelf stickers** containing the QR code and the plain-text URL in one click — "how do shoppers find out they can scan to search" is the product's job, not the owner's. The URL must be easy to say out loud and easy for shoppers to remember.
- Visiting a nonexistent or closed subdomain shows a standard "We couldn't find this store" page, with one line pointing to the main site — every dead link is also an acquisition impression.

**Search input**

- **Three parallel input methods**: typing (English or Chinese, misspellings and plain descriptions all fine), **hold-to-talk** voice input, and **photo recognition**.
- Voice and photo both include a "confirm what I heard/saw" intermediate step: the system first shows "I heard / I recognized: XX," and the shopper confirms or retries before the search runs — so the flow tolerates accents and recognition errors. In a noisy store, when voice recognition is unsure, offer several candidates for the shopper to tap instead of a single result that fails repeatedly.

**The standard search-results page** (fixed structure, top to bottom)

1. **Header**: back control, page title, EN/中 language toggle at top right; below it, echo the shopper's original query (e.g., "韩式辣酱").
2. **Collapsible "thinking" strip**: while searching, it expands in real time to show what the system is doing (understanding the question → searching store memory → picking an answer); once results arrive it auto-collapses to a single line — "HOW IT SEARCHED · 3 STEPS" (with the step count). Anyone curious can tap it open. The answer is the point; the process must never upstage it.
3. **Answer banner**: one plain-language sentence, visually highlighted, shown in the current UI language, e.g., "Found a few possibilities — most likely Wang Korea Gochujang on shelf B4." Four tones of voice:
   - Confident hit ("It should be XX on shelf B4")
   - Multiple candidates ("Found a few possibilities — most likely …")
   - Category guidance (no precise match: "Items like this are usually near shelf B4")
   - A clear "not found"
4. **Candidate list**: one question can match several similar products (a shopper asks for "Korean chili paste" and the store carries five gochujang brands). **List them all, ranked by likelihood**, with a count ("5 POSSIBLE ITEMS"). Each card shows: a real shelf-photo thumbnail, the product name, a **shelf-number badge** with a location pin (e.g., B4), and how many times it's been seen ("seen 1×"). Thumbnails must be crops from this store's actual shelf photos — shoppers hold up their phone and match the packaging; stock images are useless.
5. **"WHERE TO FIND IT" map**: the store floor map with the **target shelf highlighted in red**, and neighboring shelves (e.g., B5, C3) rendered normally for orientation; the map component must support a "main shelf + left/right side positions (L/R)" structure; when candidates span multiple shelves, tapping a candidate switches the highlight.

**Other**

- The results page offers a no-login, one-tap **"I looked — it's not there" feedback** control (see Section 8).
- On no results, suggest rephrasing, and record the miss in the insights data.

### 4.2 Staff side (used in the store)

- Staff enter with a **store-level 4–6 digit PIN** — no account registration (staff are extremely reluctant to deal with software; any extra step kills adoption). The owner sets the PIN and can change it anytime.
- **Shelf scanning** is the core flow:
  1. Pick the shelf (tap it on the floor map, or pick from the shelf-number list);
  2. Take photos on the spot, or **multi-select and batch-upload** from the phone's photo library;
  3. Each photo has its own processing state (pending / recognizing / done / failed); one failed photo never blocks the batch;
  4. Recognition results are **merged and deduplicated across photos**; misrecognized items can be removed;
  5. Save with one tap, with live progress.
- On save, the system automatically does two things:
  - Generates a **fixed set of multilingual aliases** for new products (English, Chinese, pinyin/romanization, common misspellings) — no language-configuration options at all; we'll extend this when we sign stores with non-English/Chinese clientele;
  - Records this scan as one more **location confirmation**, backing the "seen N×" trust indicator.
- **Shelf management**: browse products by shelf; edit (name / aliases / category / shelf), delete, add manually. Destructive actions such as clearing an entire shelf are owner-account only, with a second confirmation showing how many products will be affected.
- **Test search**: staff can immediately check "can shoppers find this now?" after scanning; test-search traffic is excluded from statistics.

### 4.3 Insights for the owner

- Top-searches ranking and hit rate. **"Products shoppers couldn't find"** splits into two lists:
  - The store genuinely doesn't carry it → presented as purchasing hints;
  - The store probably carries it but it hasn't been photographed → **one-tap "re-scan reminder"**; when staff photograph it and save, the item clears automatically.
- An **automatic weekly report** emailed to the owner: search volume, top searches, missed products, how much the store memory grew, and how many errors were corrected this week — owners don't log into dashboards; the weekly email is the key touchpoint for proving ongoing value and preventing churn.
- The owner's view shows usage only (photos taken, shopper searches); **never any cost figures or internal technical metrics**.

---

## 5. Tenancy and Accounts

- Every store is a **fully isolated tenant**: product memory, photos, floor map, logs, and statistics are invisible across stores. **"A shopper seeing another store's shelf number" is the worst-case failure — write it into the acceptance criteria.**
- Exactly two access levels, **no role system**:
  - **Owner account**: proper registration with email/phone, self-service recovery; manages store settings, shelf management, insights, and data export;
  - **Staff PIN entry**: shelf scanning and test search only.
- Destructive or sensitive actions (clearing a shelf, bulk deletion, changing settings, exporting data) require the owner account plus a second confirmation.

---

## 6. Store Onboarding and the Floor Map (no editor — customer sends video, we draw the map)

- **We are not building a floor-map editor in v1.** The flow: after signing up, the owner is prompted to **record a video walk-through of the store** (one lap, capturing shelf layout and aisle signs, with a one-screen filming guide) and upload it; **we manually produce the store's floor map** from the video and publish it to their store; the owner checks that "the numbers on the map match the aisle signs in the store" and confirms, or sends it back with a note. Map turnaround time carries **no external commitment**; internally it's managed as a queue.
- The product must support this pipeline:
  - **Large video upload**: phone-shot files must upload reliably — multiple clips, visible progress, resume after network drops, and an explicit "we've received it" confirmation;
  - **Platform-side mapping tickets**: notify us when a video arrives; downloadable from our back office; an internal mapping tool (doesn't need to be user-friendly — it's for us) to attach the floor map and shelf numbering to that store; one-click publish with owner notification;
  - After confirmation, matching **shelf-number labels** are printable (map numbers must match the physical aisle signs — that's the precondition for "find it by the map").
- **No dead time while waiting for the map**: before the map is ready, the owner can start scanning shelves against a plain "shelf-number list," and the shopper page gives text directions ("shelf 3"); when the map is published it links to the existing shelves automatically — not a single record is lost. **Map production must never block the first scan: the owner must be able to photograph a shelf and find it in search on day one.**
- **Later layout changes**: the owner files a "layout update" request in the product (a new video or a written note); we revise and republish. When shelves are moved, merged, or split, **product memory must move with them — no data loss.**
- ~~**Productize the staffed full-store onboarding service**: in-product booking and scheduling; several people scanning different shelves simultaneously, aggregated into one "onboarding session" with a whole-store coverage board; on completion, an automatically generated **acceptance report** (N shelves and M products captured, spot-check search demos, uncovered areas) — a paid human service needs a visible deliverable and acceptance criteria. Full-store re-scans reuse the same scheduling and delivery flow.~~ **[WITHDRAWN 2026-07-25: not being built]**

---

## 7. The Platform Operator's Back Office (ours)

- **Tenant console**: one row per store — status, product count, shopper searches in the last 7 days, last scan time, this month's AI cost, health score; auto-generated churn-risk list ("7 days with zero searches," "30 days with zero updates") with suggested actions. With a low-priced subscription, a lost store is hard to replace; retention runs on proactive operations, not on waiting for complaints.
- **Mapping queue**: to-draw / drawing / awaiting owner confirmation / published, centrally scheduled, overdue items flagged red — the map is our first deliverable to every new customer and can't live in anyone's head.
- **Per-store cost accounting** exists only in our back office. Abnormal usage (suspected scraping, accidental misuse, sudden spikes) triggers **alerts + human intervention**, never automatic cutoff.
- **Impersonation** ("enter the store as the tenant," read-only or act-on-behalf, fully audit-logged) — the only efficient way to handle "it doesn't show up on my end" support cases; a built-in **ticket system** (one-tap issue reporting from the store side, automatically attaching store identity and context); broadcast announcements; a self-serve help center in English and Chinese.
- The store-facing product exposes **no debug-style screens that reveal internal data structures**; cross-store inspection tools exist only in our back office. Stores keep a plain-language "data health page" (product totals, shelf coverage, last scan, anomalies).
- **Availability is defined by each store's business hours**, not by our clock: maintenance windows avoid open hours; **no single store's peak activity (bulk photo uploads on onboarding day, store-video uploads) may slow down any other store's shopper search** — a hard acceptance criterion. If the AI service is down, the shopper page automatically degrades to plain text matching over existing aliases with a friendly notice — never a blank page. Releases must not interrupt search for stores that are open.
- **Data ownership and account closure**: in writing, "the store memory belongs to the store." The owner can self-export at any time (product–alias–shelf table, original photos, floor map), unlimited and free. **Closure means deletion — no retention period** — so the closure flow must strongly steer the owner to export first, state plainly that "deletion cannot be undone," require double confirmation, and send a completion notice once deletion is done.

---

## 8. Keeping the Memory Right (no auto-expiry — simple rules + a human loop)

- A product may have **multiple active locations** (regular shelf and a promo end-cap both photographed → both shown). No automatic arbitration, no expiry timers; when a location is wrong, staff simply delete it in shelf management.
- **The correction loop is the quality backstop — it must be built**:
  - Shopper-side one-tap "I looked — it's not there" feedback → after several independent reports on the same product, the answer automatically drops to the "worth double-checking" tone and a staff review reminder is created;
  - Staff can **fix it right on the search-results page** (change the shelf / delete the misrecognition) without detouring into management screens;
  - Feedback can only lower the answer's confidence tone — it can never modify data directly. A public entry point will be clicked maliciously; every data change must be confirmed by staff;
  - The weekly report shows "N errors corrected this week" — the owner must be able to see the system getting more accurate.
- **Bulk import (optional, fine for phase 2)**: upload a product list exported from the POS (CSV); aliases are pre-generated and items sit in an "unlocated" state (excluded from shopper search for now); shelf-scan results auto-match and merge against the list — cutting onboarding time.

---

## 9. Language and the Physical Environment

- **The interface ships in exactly two languages: English and Chinese**, with a one-tap toggle. No per-store language configuration. Sales materials, the help center, and legal terms also come in these two languages only.
  **[ADDED 2026-07-28] The marketing site's default language follows the visitor's browser/system language** (Chinese-system visitors land on `/zh` automatically); a manual switch is remembered for a year via the `NEXT_LOCALE` cookie. Search-engine crawling is unaffected — the bare domain still serves the English page.
- **The store's brand comes first**: the shopper page header shows the store's name and logo (store profile: name, logo, opening hours, announcements — owner-editable anytime); the footer keeps a consistent platform mark. The owner is buying "my own store's finder"; the shopper-facing page must look like the store's own service.
- **Treat the physical store as a first-class environment**:
  - Weak or dropped in-store connectivity: photos are cached locally and auto-resume uploading; the upload queue is visible; locking the screen or switching apps loses nothing;
  - All error copy is friendly, plain language; technical error text must never reach a shopper;
  - Portrait phone is the primary form factor; "scan and use, nothing to install" goes into acceptance criteria; the staff side prompts "add to home screen";
  - If camera/microphone permission is denied, never dead-end — offer an alternative path (photo denied → guide to typing) and explain how to re-enable.
- **Staff training materials**: a one-page printed cheat sheet (for the break room) plus 2–3 minute how-to videos, in English and Chinese — grocery staff turn over quickly; the store must be able to train new people itself, or the product decays with every staffing change.

---

## 10. Compliance and Content Safety

- Signup includes explicit terms acceptance with version recorded; updated terms require re-confirmation.
- The **disclaimer** states: "This service provides product-location guidance only, for reference, and does not constitute product advice of any kind." Location accuracy is never quantified in any marketing.
- Photos and data:
  - Faces detected in staff shelf photos are automatically blurred; shopper-facing thumbnails are cropped to the product area only (the shopper page is publicly accessible — it is the largest photo-leak surface);
  - **Store walk-through videos are retained**, used solely by the platform for map production and archival — never exposed in any store-facing or shopper-facing interface;
  - Photos and voice clips submitted by shoppers during search are the shopper's personal data: automatically deleted shortly after recognition completes, with a one-line notice at the input ("Photos are used only to identify the product and are not kept"); owners see the transcribed query text only and can never replay a shopper's voice.
- **Confirm the AI vendor's terms in writing, clause by clause: that our commercial resale model is permitted, and that stores' photos and data are not used for model training** — if the upstream terms don't allow commercial use, the entire business is built on a contract breach. This is the number-one item to verify.
- **Content safety**: every store's shopper page is a public, login-free AI endpoint, and people will try to break it — prompt-injection attempts, abuse, and off-topic chatter get a polite "I can only help you find products," are never acted on, and are excluded from top-search statistics. The shopper page offers no way to enumerate a store's full catalog, and rate limiting backs this up — the multilingual alias corpus is the platform's most valuable data asset and must not be scraped wholesale by a competitor.

---

## 11. Decisions Already Made (for PM alignment)

1. Simplicity above all — our users are not highly educated; when in doubt, don't build it.
2. No geographic restriction on sales; languages are English + Chinese only.
3. One account, one store. No chains, no cross-store data sharing.
4. Per-store subdomain `xxyyzz.whataisle.com`, permanent once chosen.
5. No floor-map editor: the customer sends a store video and we draw the map by hand; no external turnaround commitment.
6. Store videos are retained (platform-internal use only).
7. Account closure deletes all data immediately — no retention period (strong export prompt + double confirmation first).
8. No automatic memory expiry; memory quality relies on shopper feedback + staff on-the-spot correction.
9. Location accuracy never appears in marketing; the disclaimer covers it.
10. Pricing, billing, and trial mechanics are out of scope here and will be defined separately.

---

## 12. Deployment Constraint

The entire service (store pages, back office, AI recognition and search) **deploys on Google Cloud**. This is a fixed technical boundary; all component choices are made within that ecosystem.

- Domain `www.whataisle.com`; wildcard resolution and certificates for store subdomains (`*.whataisle.com`) must be part of the deployment architecture.
- Set **budget caps and cost alerts** in the cloud from day one — under an "unlimited search" promise, runaway cloud spend is the platform's biggest business risk. Cost monitoring is a launch prerequisite, not an afterthought.

---

## One-Sentence Summary

**"I want to build a subscription service sold online to neighborhood grocery stores: staff casually photograph shelves and the system grows a product-location memory searchable in English and Chinese; shoppers scan an in-store QR code to open the store's own page (`xxyyzz.whataisle.com`), ask by typing, speaking, or taking a photo, and get a shelf-level answer with a highlighted map. The owner signs up online, sends one store walk-through video for us to draw the floor map, and starts scanning the same day; every store's data is fully isolated; I can see every store's health, cost, and pending work in my back office; the whole thing runs on Google Cloud. And every design decision obeys one principle: simple enough to use without being taught."**
