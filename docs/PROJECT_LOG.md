# Project Log

> ## ⚡ NEXT SESSION — START HERE (updated 2026-07-08, VS Code → PowerShell session handoff)
>
> **Machine state (new laptop, fully set up):** working repo is `C:\Work\CareerOS`
> (`Desktop\CarrerOs` OneDrive clone and external-disk `D:\Work\JobIntel` are stale
> leftovers — deletable). Local stack verified: `npm run docker:up`, migrations applied,
> API boots, scraper venv ready. SSH key + GitHub credentials both work from this machine.
> A global permission rule allows `ssh root@139.59.15.220 *` without prompting.
>
> **Production is LIVE** at 139.59.15.220 (DigitalOcean, Ubuntu 24.04): 5 containers,
> schedulers ticking (crawl 15m / discovery 10m / boards 24h), nightly backups. Deployed
> at commit `dc07247` (2026-07-08). Server ops: `ssh root@139.59.15.220`, `cd careeros`,
> **always** pass `--env-file .env.prod` to compose. Update = `git pull && docker compose
> -f compose.prod.yml --env-file .env.prod up -d --build` (migrations auto-apply on boot).
>
> **Current production state (read the 2026-07-07/08 incident entry below for full RCA):**
> - Gemini free-tier daily quota exhausted → **AI pipeline paused at the circuit breaker**
>   (fails fast, retries every 10 min). 4,287 jobs unembedded. Recovers automatically at
>   the daily reset (~12:30pm IST) or permanently once paid quota exists.
> - `NOTIFY_MIN_SCORE=60` (temporary), rogue account deleted, `ai_usage` table +
>   `GET /api/ai/usage` live. Measured spend estimate: ~$3/month steady state.
>
> **NEXT WORK ITEM (decided 2026-07-08, before Phase D): `VertexGeminiProvider`.**
> CareerOS uses the Gemini **Developer API** (raw fetch, `generativelanguage.googleapis.com`,
> `?key=` auth). Google Cloud free-trial credits (Suyash has ₹28,321) can NOT pay for it —
> they only cover **Vertex AI**. Plan: new provider class implementing `LlmProvider` +
> `EmbeddingProvider` (split interfaces live in `modules/ai/llm.provider.ts`), registered
> as `vertex` in the ai.module factory. generateContent body ≈ identical (URL changes to
> `aiplatform.googleapis.com/v1/projects/{p}/locations/{l}/publishers/google/models/…`);
> auth = service-account OAuth2 Bearer via `google-auth-library`; embeddings use `:predict`
> (different shape); re-embed everything after switch (~$1, per-model column handles it).
> **Blocked on Suyash:** GCP project + Vertex AI API enabled + service-account JSON key.
> Until then the interim unblock for notifications is enabling Developer-API prepaid
> billing OR just waiting for daily quota resets.
>
> **Suyash's open items:** GCP project/service account (above) · re-export resume as a
> text-based PDF and upload (vision-parse got only 15 skills — no JavaScript/TypeScript/
> MongoDB — depressing all match scores; likely worth more than any tuning) · GitHub rename
> CarrerOs → CareerOS · delete the two stale repo copies.
>
> **2026-07-08 PRODUCT PIVOT: docs/ROADMAP.md is now the canonical plan** —
> "AI recruiter, not AI crawler": decision layer, opportunity-first notifications,
> referral subsystem, application strategy, tracker-then-learning-engine, phases D–H
> with hard principles (no fabricated numbers, public-source contacts only, assistive
> never autonomous). The Phase D list below is superseded by ROADMAP.md Phase D but
> kept for history:
>
> **Phase D — original scope (superseded, see ROADMAP.md):**
> 1. Contact/email harvesting in the prober (mailto: + jobs@/careers@/talent@ from pages
>    already fetched) → `Company.contactEmails String[]` (migration needed) → shown in
>    notifications. Individually-written outreach only, never bulk.
> 2. Timeline analytics from existing data (firstSeenAt/lastSeenAt/REMOVED): job timeline
>    endpoint + posting-lifetime/frequency stats in company intelligence. (Per-field change
>    events like salary-added need an ingest job_events table — deferred, batched upsert
>    makes old-vs-new comparison nontrivial.)
> 3. Skill-gap insights with real "+X%" — recompute stored scoreBreakdowns minus each
>    missing skill; aggregate across matches.
> 4. Applications tracker endpoints (schema exists since Phase 2 + resumeVersionId/source
>    fields): create-from-job, status transitions writing ApplicationEvent, list + stats.
> 5. Small fixes: POST /auth/change-password (verify current, rehash, revoke all refresh
>    tokens — Suyash's password transited chat during deploy); findOrCreateFromBoard must
>    stamp discoverySource (board companies show as "manual" in funnel stats).
>
> Prod account: suyashtripathi2116@gmail.com. Telegram chat_id 940841002. Local-dev secrets
> live in `apps/api/.env` (NOT in git — Suyash carries a copy; regenerate if lost, only the
> GEMINI_API_KEY and TELEGRAM_BOT_TOKEN are external). Deploy lessons in
> DEPLOY_WALKTHROUGH.md. Read DECISIONS.md + VISION.md + ARCHITECTURE_REVIEW.md before
> making structural changes. GitHub repo rename to "CareerOS" still pending (Suyash's task).

Running journal of decisions, gotchas, and progress — kept in the repo (not on any one machine)
so it survives PC changes. Newest entries at the bottom. When resuming work with Claude on a new
machine, have it read this file plus `ARCHITECTURE.md` first.

---

## 2026-07-06 — Session 1: Stack decision, Phase 1 (Architecture), Phase 2 (Database)

### Context

Suyash's background is MERN (MongoDB/Express/React/Node + MySQL at work). This project
deliberately steps outside that comfort zone; the reasoning was discussed and agreed before
starting:

- **Next.js over plain React** — low learning cost from a React background (few days), and it's
  what most "React role" job postings actually use.
- **NestJS over Express** — the real learning investment (~1–2 weeks). Chosen because the
  project's goal is to *demonstrate* Clean Architecture/DDD/SOLID, and NestJS enforces those
  boundaries structurally (modules/DI/guards) instead of relying on folder discipline.
- **PostgreSQL + pgvector over MongoDB/MySQL** — matching needs embedding similarity search;
  pgvector keeps relational data and vectors in one database. Coming from MySQL, Postgres is a
  small hop; Prisma smooths the rest.
- **Python scraper service** (Suyash's own suggestion) — for JS-heavy/anti-bot career pages where
  Python's ecosystem (Playwright, BeautifulSoup, Scrapy) beats Node's. Node workers still handle
  the clean JSON APIs (Greenhouse/Lever/Ashby) directly.
- **MVP-first sequencing** — full-vision architecture, but build order: auth → resume parsing →
  2–3 ATS crawlers → matching → dashboard. LinkedIn/Indeed direct scraping is permanently out of
  scope (ToS-prohibited); referral discovery limited to public info.

### Phase 1 — Architecture & scaffolding (done)

Monorepo at `d:\CareerOS` (npm workspaces + Turborepo): `apps/web` (Next.js 16),
`apps/api` (NestJS 11 + Prisma), `apps/workers` (BullMQ), `apps/scraper` (Python FastAPI +
Playwright, own venv), `packages/shared` (Zod schemas consumed by web + api).
Full rationale and service map: `ARCHITECTURE.md`.

**Gotchas hit (do not re-learn these):**

1. **Prisma pinned to 6.19.3 — do not upgrade to 7.x casually.** Prisma 7 changed to
   driver-adapter + ESM generated client and broke the standard NestJS integration pattern.
   Downgraded and pinned exact versions in `apps/api/package.json`.
2. **`ioredis` pinned to 5.10.1 in `apps/workers`** — must match the version BullMQ itself
   depends on, otherwise TypeScript sees two incompatible `Redis` types and the
   `Worker({ connection })` option fails to type-check.
3. **`packages/shared` needs a real build** (`npm run build --workspace=@careeros/shared`) before
   `apps/api` can run — Node can't import raw `.ts` at runtime even though Next.js's bundler can.
4. **`prisma.config.ts` must be excluded in `apps/api/tsconfig.build.json`** — otherwise Nest
   emits `dist/src/main.js` instead of `dist/main.js` and `start:prod` breaks.

### Machine setup performed on this PC (repeat on any new machine)

- WSL2 + Ubuntu: `wsl --install --no-launch` (needs admin + **reboot**)
- Docker Desktop 4.80 via `winget install -e --id Docker.DockerDesktop`
- After reboot: launch Docker Desktop once, accept license, wait for engine
- See `docs/NEW_MACHINE_SETUP.md` for the complete checklist.

### Phase 2 — Database (done)

Schema: `apps/api/prisma/schema.prisma` — 17 models. Key decisions:

- **Embeddings in separate tables** (`resume_embeddings`, `job_embeddings`) with a `model`
  column — re-embedding with a newer model never touches business rows.
- **Canonical `skills` table + join tables** — skill-gap analysis is a SQL join, not string
  matching.
- **Jobs deduped by `(companyId, externalId)`, never hard-deleted** — `status` + `lastSeenAt`
  give removed-job detection and history.
- **`application_events` append-only timeline** for the tracker.
- **`crawl_runs`** — one row per crawl per company; future admin panel reads this.

Migrations (both applied and verified against live Postgres 17 + pgvector 0.8.4):

1. `20260706050416_init` — generated by Prisma.
2. `20260706050432_add_hnsw_vector_indexes` — **hand-written SQL**, because Prisma's DSL cannot
   express pgvector HNSW indexes. Any future vector-index change also goes in a hand-written
   migration. Uses `vector_cosine_ops` (matching engine will use cosine similarity).

Verified end-to-end: `docker compose up -d` (Postgres/Redis/MinIO all healthy) →
`prisma migrate dev` → API boots against live DB → `GET /api/health` returns 200.

### Phase 3 — Backend core (done, same session)

Built and E2E-verified against the live stack:

- **Auth** (`modules/auth`): register/login (bcrypt-12), access JWT (15 min) + opaque refresh
  tokens (random 256-bit, stored as SHA-256 hashes, 7-day TTL). **Rotation with theft detection**:
  every refresh consumes the token; presenting an already-consumed token revokes *all* the user's
  sessions. Global `JwtAuthGuard` (secure by default, `@Public()` to opt out) + `RolesGuard` +
  `ThrottlerGuard` (100 req/min global, 5/min register, 10/min login).
- **Users** (`modules/users`): profile (`GET /users/me`, passwordHash stripped) and preferences
  (`GET/PUT /users/me/preferences`, upsert).
- **Storage** (`modules/storage`): S3 wrapper around MinIO, `forcePathStyle: true`, bucket
  auto-created on boot. Nothing else touches the S3 SDK.
- **Resumes** (`modules/resumes`): `POST /resumes` multipart PDF (5 MB cap) → MinIO → immutable
  `ResumeVersion` with extracted raw text; versioning by passing `resumeId`; list/get/delete
  (delete also removes MinIO objects). First resume auto-primary, 10-resume cap.

**Bugs found by E2E testing (why we test against real data):**

1. **Postgres rejects ` ` in JSONB** — real resume PDFs embed NUL chars in extracted text.
   Fix: strip `\p{Cc}` control chars (except `\n\r\t`) before storing. `resumes.service.ts`.
2. **Orphan rows on failed upload** — resume row was created before text extraction, so a bad PDF
   left a versionless resume that also stole the auto-primary flag. Fix: extract first, and
   roll back a freshly-created resume row if storage/DB fails after it.
3. **Data-quality note:** PDFs from design tools (Canva etc.) with subsetted fonts and no
   ToUnicode map extract as gibberish. Pipeline handles them fine; flagged for an OCR fallback in
   Phase 5. Suyash's own resume PDF is one of these.

Deferred within Phase 3 (need external credentials, structure is ready for them): email
verification + password reset (needs SMTP), Google/GitHub OAuth (needs OAuth app credentials).

### Phase 4 — Job Discovery Engine (same day)

Design doc: `docs/PHASE4_CRAWLER.md` (sources, four discovery channels, sync semantics).
Product direction from Suyash: personal intelligence agent, NOT a Naukri-style portal; real
applyable jobs matching his experience; city-based company discovery idea (Indore/Pune/Bangalore)
adopted as a *supplement*, with the **discovery flywheel** as the primary channel (board jobs →
auto-create company → detect ATS from apply URL → direct crawls forever).

Built:
- `packages/shared/src/crawler.ts` — `NormalizedJob`/`BoardJob` Zod contracts all adapters speak.
- API: `companies` (ATS auto-detect from any board/posting URL — Greenhouse/Lever/Ashby/Workday/
  Recruitee/Teamtailor/SmartRecruiters patterns), `jobs` (filtered/paginated list), `internal`
  (token-guarded ingest: per-company sync with upsert + REMOVED detection + CrawlRun accounting;
  board ingest with flywheel find-or-create), `crawl` (manual trigger enqueues to BullMQ;
  GET /crawl/runs for observability).
- Workers: Greenhouse/Lever/Ashby adapters (official JSON APIs), RemoteOK board adapter,
  refresh-all fan-out worker (24h repeatable via `upsertJobScheduler` + manual trigger), retries
  with exponential backoff, concurrency 5, dedupe by BullMQ jobId.
- Workers write ONLY through the API's internal endpoints (`x-internal-token`, timing-safe
  compare) — Prisma/API stays the single schema owner.

Gotchas:
- **zod v4 standardization**: root hoisted zod 4 (via eslint-plugin-react-hooks!) while shared
  pinned v3 → cross-package type errors ("SomeType"). Fixed by pinning `zod@^4` in shared + api.
- **NestJS circular-import trap**: exporting a const from a module file that imports the
  controller using it → const is `undefined` at decorator evaluation → DI token becomes
  "BullQueue_default". Constants live in their own file (`crawl.constants.ts`).
- Express JSON body limit raised to 20mb (sync payloads carry hundreds of descriptions);
  descriptions capped at 30k chars in adapters.
- Plaid's Lever board returns 0 jobs (they migrated ATS) — harmless, but a reminder that seed
  data goes stale; the flywheel doesn't.

### Phase 5 — AI layer (core), same session

Product vision expanded first — see `docs/VISION.md` (Job Intelligence Platform / "never miss an
opportunity", hiring signals engine, application analytics, one-click assistant NOT auto-apply).
Gemini chosen as first LLM provider (free tier, no card): key in `apps/api/.env`
(`GEMINI_API_KEY` + model config). Models: `gemini-3.5-flash` (text/JSON/vision),
`gemini-embedding-2` at 1536 dims (matches pgvector schema).

Built:
- `modules/ai` — **LLM abstraction layer**: `LlmProvider` interface (generateText/generateJson/
  embed) + `GeminiProvider` (plain fetch, no SDK; 429/5xx retry with exponential backoff; JSON
  mode; multimodal file parts). Provider chosen by `AI_PROVIDER` env — OpenAI/Claude drop in
  later without touching features.
- `modules/resumes/resume-intelligence.service.ts` — structured resume parsing (skills with
  categories/years, experience, education, projects, summaryForMatching paragraph), populates
  canonical Skill/ResumeSkill tables, stores resume embedding via raw SQL upsert.
  **Gibberish detection + PDF vision fallback**: when extracted text fails the letter-ratio/
  common-words heuristic (Suyash's own resume does — subsetted fonts), the PDF itself goes to
  the multimodal model. Verified live: his resume parsed correctly via fallback (17 skills).
- `modules/matching` — two-stage engine: (0) backfill embeddings for ACTIVE jobs lacking them,
  (1) pgvector cosine top-40 prefilter, (2) LLM deep-scores top-15 in batches of 5 →
  JobMatch upsert (overall/technical/experience scores, missingSkills, frank reasoning).
- AI work runs as BullMQ processors *inside the API app* (`@nestjs/bullmq` WorkerHost) — the
  workers app stays crawl-only; AI needs Prisma+LLM which the API already owns. Deliberate
  deviation from "all queue consumers live in apps/workers"; can split later if AI load grows.
- Endpoints: `POST /resumes/versions/:id/parse` (re-parse), `POST /matches/generate` (202 +
  background), `GET /matches?minScore=`. Upload now auto-enqueues parsing.

Free-tier lessons (important for future LLM work — hard-won over ~2 hours of 429s):
- **The free tier counts each ITEM in a batchEmbedContents call as a request** against the
  per-minute cap (~100/min). Batches of 100 exhaust it instantly. Settled: 20 items/call,
  15s between calls, embed text capped at ~2k chars/job.
- **Persist embeddings per chunk, never after the full run** — a quota wall mid-backfill then
  loses nothing and the next run resumes where it stopped.
- **Backfill must be non-fatal to matching** — when the daily embed quota dies, score with
  whatever's embedded; coverage completes on a later run/day.
- **Pace LLM scoring calls too** (8s between batches) — they share the RPM budget with
  everything else.
- **Never removeOnFail without job-level attempts** — the first quota death vanished silently.
- Bottom line: free tier is fine for daily incremental operation (a few new jobs/day), painful
  for bulk backfills. First paid tier (~$0) or an OpenAI $5 credit would have done the initial
  1,307-job backfill in under a minute.
- `import type` required for interfaces used in NestJS constructor injection when
  isolatedModules + emitDecoratorMetadata are both on (TS1272).

Deferred within Phase 5 (need this pipeline's output; build next): per-job tailored resume +
cover letter + outreach message + interview prep generation; salary estimation; company
intelligence; skill-demand analytics.

### Phase A — Data-platform hardening (done, same day)

Roadmap realigned per architecture review + Suyash's confirmation: A → B → B.5 (Company
Intelligence Layer) → C, modular monolith (3 deployables), budget $0-10/mo, Opportunity Score
replaces plain match %, Learning Intelligence + browser extension added to vision (VISION.md
updated). Referrals + dashboard explicitly postponed. Name: Suyash prefers "CareerOS" — rename
NOT executed yet (his explicit go needed; repo is his).

Built and live-verified:
- **Batched upsert**: one `INSERT ... ON CONFLICT` per 500-job chunk via `unnest` arrays,
  `xmax = 0` distinguishes creates from updates (ingest.service.ts). Replaces 2-queries-per-job.
- **Tiered monitoring**: `CrawlTier` (HOT 30m / WARM 4h / COLD 24h) + `nextCrawlAt` on Company;
  scheduler ticks every 15 min and fans out only DUE companies; sync bumps nextCrawlAt by tier;
  failures back off 1h instead of hot-looping. Boards get their own 24h scheduler.
- **Embed-at-ingest**: new jobs from any sync are embedded within seconds via `embed-jobs`
  queue (EmbedProcessor) — the prerequisite for Phase C incremental matching. Bulk backfill
  path retained as fallback.
- **Full-text search**: `search tsvector` GENERATED column (hand-edited migration — Prisma
  can't express generated columns; declared `Unsupported("tsvector")?` in schema so migrate
  doesn't drift) + GIN index; jobs list search now uses `websearch_to_tsquery` (phrases, OR,
  -exclusions) with ts_rank ordering.

Smoke test doubled as product validation: re-crawl found **Stripe +4 new / -2 removed, OpenAI
+4 / -6 within hours of the previous crawl** — live hiring movement detected and new jobs
embedded in seconds. Deferred from A (documented, low-risk): AI processors still run inside
the API process — split into a second process entrypoint when AI load grows.

## 2026-07-07 — Session 2: Rename to CareerOS + Phase B (Company Discovery Engine)

### Rename (JobIntel → CareerOS)

Everything renamed with data preserved: Postgres db/role (`ALTER DATABASE/ROLE`, via temp
superuser — a role can't rename itself), docker compose project + volumes (created careeros_*
volumes, `cp -a` via alpine, old jobintel_* volumes kept as backup), MinIO bucket + root creds
(objects copied via mc), package scope `@careeros/*`, all code/docs/env branding. Local folder
stays `D:\JobIntel` on the old PC (VS Code workspace lock) — irrelevant, new PC clones fresh.
**GitHub repo rename = manual step for Suyash** (Settings → rename to `CareerOS`; old URL
redirects automatically).

### Phase B — Company Discovery Engine (live-verified)

Lifecycle implemented: Discover → Verify Website → Extract Metadata → Find Career Page →
Detect ATS → Assign Tier → MONITORED. New schema: `DiscoveryStage`, `confidence` (0-100 from
weighted `confidenceSignals`: websiteVerified 15 / careerPageFound 20 / atsDetected 25 /
jobsExtracted 25 / monitoringHealthy 15), `lastProbedAt` (stage-based reprobe cooldowns, 7d/30d),
`discoverySource`, `teamSize`.

Pieces:
- `packages/shared/src/ats.ts` — detectAts moved to shared (single source of truth for API +
  workers) + `discovery.ts` contracts (CompanyCandidate, DiscoveryResult).
- API `modules/discovery` — bulk-discover (dedupe: ATS identity → website host → name; enrich-
  don't-overwrite merges), probe-due query, result application with stage transitions +
  duplicate-board detection, `GET /discovery/stats` funnel endpoint.
- Workers `discovery/prober.ts` — the conversion engine (≤12 polite requests/company):
  resolve career-hint redirects (converts board apply-links to real ATS) → verify website +
  harvest title/meta-description → scan homepage for career/ATS links → probe common paths
  (/careers, /jobs...) → scan career page → **guess ATS tokens from company-name slugs and
  verify against the ATS APIs directly** (free verification — wrong guess 404s; this single
  trick converted LinkedIn, Zapier, Instacart, HackerRank from name alone).
- Seeds: YC public dataset (yc-oss.github.io — 6,007 companies, 1,482 actively hiring, with
  website/industry/team-size/locations) via `POST /crawl/seed {source:'yc', limit}`.
- Schedulers: discovery-fanout every 10 min (25 companies/tick, concurrency 3), monitored
  companies flow straight into the existing tiered crawl.
- Ingest now maintains confidence after every crawl (jobsExtracted, monitoringHealthy from
  last-10 crawl success rate).

**E2E results (one evening, one laptop, $0):**
- Funnel: 198 companies — **41 MONITORED (3 → 41, conversion 20.7%)**, 15 CAREER_PAGE_FOUND
  (ATS unknown — future Python-scraper targets), 3 WEBSITE_VERIFIED, 45 not yet probed,
  94 UNRESOLVABLE (mostly name-only RemoteOK noise; monthly retry).
- **Active jobs: ~1,300 → 2,647.** Auto-crawled minutes after conversion: Instacart 154,
  Fresha 153, Flexport 128, Gusto 78, Checkr 52, LinkedIn 53, Algolia 42, Webflow 22...
- Name-only cohort (RemoteOK strays) converts ~8%; website-having cohort (YC) ~35-40%.
- Reservoir on tap: ~1,380 more hiring YC companies (`POST /crawl/seed` with higher limit),
  then full 6k dataset, then more directories.

Bugs found/fixed during E2E: RemoteOK company names arrive HTML-encoded ("RG&amp;T") —
decode at adapter; rapid manual fan-outs dedupe to one batch (by design — jobId per company).

Prisma gotcha added to the pile: generated columns need `@default(dbgenerated())` on the
`Unsupported` field + `@@index(..., type: Gin)` declared, or migrate diff tries to drop the
expression and index every migration.

### Phase B.5 — Conversion push + Company Intelligence Layer (same session)

Direction confirmed with external review + Suyash: keep investing in the data engine ("the
crawler is the moat"); Opportunity Score v1 ships WITH Phase C (notification needs scoring);
most company intelligence derives from OUR OWN job corpus, not external scraping.

Built:
- **4 new ATS adapters** (all public JSON APIs, verified live before coding): Workable
  (apply.workable.com widget API), SmartRecruiters (postings list + per-posting detail fetch,
  capped/throttled), Recruitee ({tenant}.recruitee.com/api/offers), Breezy ({tenant}.breezy.hr
  /json). CRAWLABLE_PROVIDERS now 7. detectAts patterns + prober token-guessing extended to all.
- **Company Intelligence Layer** (`modules/intelligence` + `company_intelligence` table):
  LLM-extracts per-company profile from up to 15 of its own job postings (techStack,
  remoteFriendly, visaMentioned, hiresJuniors, avgExperienceReq, roleMix) + SQL aggregates
  (salary medians, active jobs) + **hiring velocity/trend** from crawl history (excludes the
  initial import burst; INSUFFICIENT_DATA under 14 days of monitoring — no fake spikes).
  Weekly refresh cadence; `GET /companies/:id/intelligence`.
- Prober now harvests **GitHub org + engineering blog** links from homepages.
- **Per-source funnel stats** (`GET /discovery/stats` → bySource conversion) — conversion is a
  property of seed quality; measure it that way.

**Critical bug caught by E2E and the fix that followed:** SmartRecruiters returns
`200 {"totalFound":0}` for ANY company slug → token-guessing produced 31 false MONITORED
conversions. Root cause: marker/substring body checks. Fix: per-provider validators that PARSE
the response and assert a real board (SmartRecruiters requires totalFound ≥ 1; Breezy's 302 on
unknown tenants blocked via redirect:"manual"); all 31 false positives audited against the live
API and demoted. Beautiful confirmation: "New Story", falsely SMARTRECRUITERS before the fix,
re-probed to its REAL board (ASHBY/new-story) after it. **Lesson: an ATS probe must validate
shape, never just status/substring.**

**E2E results (cumulative, still one laptop, $0):**
- Funnel: 397 companies — **160 MONITORED (41 → 160), 40.3% overall conversion**.
  Per source: **YC 50%** (149/298; was ~35-40% before the new adapters), manual/RemoteOK 11%.
- **Active jobs: 2,647 → 4,536.**
- Monitored by ATS: Greenhouse 56, Ashby 53, Lever 27, **Workable 15, Breezy 7**, Recruitee 1,
  SmartRecruiters 1 (a real one).
- Intelligence profiles deriving (e.g. Brigit: react/react-native/typescript/java/gcloud,
  roleMix data-heavy, 24 active jobs, confidence 85). Remaining profiles fill on the weekly
  cadence — big intel prompts hit free-tier TPM at night-time usage levels.
- YC reservoir remaining: ~1,180 hiring companies unseeded.

### Phase C — Opportunity Score + incremental pipeline + notifications (same session)

DECISIONS.md (10 ADRs) added first — external review's best suggestion, done while fresh.

Built:
- **Opportunity Score** (`modules/opportunity`, ADR-10): 8 modular scorers — resumeFit 35,
  experienceFit 15, freshness 15, remotePreference 10, salaryPreference 10, companyQuality 5,
  hiringVelocity 5, skillGap 5. Modules without data (unknown salary, no velocity history) drop
  out and weights renormalize — missing data never silently penalizes. Per-module reasons
  persist as scoreBreakdown → **explainability** in every notification.
- **Notifications** (`modules/notifications`): channel interface + TelegramChannel (activates
  when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID set — get from @BotFather; log fallback until then);
  in-app Notification rows always written; message format = score + ✔/✖ reasons + direct apply
  link. **Notification memory**: notify once (notifiedAt), re-notify only if content hash
  changed or opportunity improved ≥5 points. NOTIFY_MIN_SCORE env (default 70).
- **Incremental pipeline**: ingest → embed → match-new-jobs queue → similarity gate (>0.45,
  protects LLM budget) → LLM score → opportunity → notify. New-job-to-phone latency now equals
  the company's crawl-tier interval.
- `POST /matches/rescore` — LLM-free opportunity recompute (freshness decays daily; preference
  changes) + notification gate.
- Application rows now record resumeVersionId + source → Resume Version Intelligence /
  "why was I rejected" analytics become possible from the first tracked application.

E2E: 5 existing matches rescored → **2 notifications with explainable reasons**; poetic detail:
38-day-old Stripe (85% resume match) scored Opportunity 71, BELOW 4-day-old Catalyst (70%
match, remote ✔) at 72 — freshness decay working exactly as intended, match% is not the story.
Memory verified: immediate re-rescore → 0 notifications. LLM daily quota exhausted late-night
mid-test (bulk re-match job left retrying — harmless, resumes with quota); the rescore endpoint
exists partly because opportunity scoring needs NO LLM.

Feature ideas logged from review: estimated-score-gain per missing skill ("learn Docker →
94→98", computable from corpus), Time Machine market-shift analytics (data already
accumulating — jobs/skills/firstSeenAt are permanent), rejection-pattern analysis (schema now
collects the inputs).

Post-review polish (review scored Phase C 9.5/10, two "fix immediately" items — both correct,
both fixed and verified same session):
1. **Official-link rule**: board-copy notifications held for directly-crawled companies (the
   official posting notifies instead); otherwise ATS board root → careers page → honestly
   labeled board link. Users never get routed through an aggregator when we know better.
2. **Verification gate**: confidence < 40 dampens opportunity 15% + visible "⚠ not yet
   verified" breakdown entry. Verified: the confidence-0 Catalyst match (72) dropped below the
   notify bar; only the trustworthy notification fired.
3. Score categories (Excellent/High/Medium/Low) added to notifications.
Also logged from review for later: internal health dashboard (C.5 scope), the outcome feedback
loop as the moat (tracker phase — schema fields already collecting), weekly "AI Career Coach"
digest (post-D backlog).

**NEXT: C.5 hardening + VPS deployment** — crawler tests, health monitoring, observability,
Docker images, deploy (~$5/mo VPS) so CareerOS hunts 24/7 instead of only when a dev machine
is awake. Then: application tracker polish → resume generator → interview prep → dashboard →
browser extension → referral assistant.

### Phase C.5 — Hardening + deploy readiness (2026-07-07)

Everything except the actual VPS purchase (Suyash's side):

- **Tests** (27, all green): OpportunityService.compute — weight renormalization when data is
  missing (unknown salary must not penalize), verification gate, freshness decay, salary-floor
  penalty, content-hash re-notify trigger; detectAts — 21 URL cases incl. negatives
  (www.workable.com, app.breezy.hr, aggregator links must NOT match).
- **`GET /admin/health`** — the internal health dashboard: companies funnel, active/24h-new
  jobs, matches, notifications, 24h crawl success rate, **companies whose last 3 crawls all
  failed** (the "silently broken" list), live BullMQ queue depths for all 10 queues.
- **Graceful shutdown** (enableShutdownHooks) for clean container stops.
- **Dockerfiles**: api (multi-stage, workspace-aware, `prisma migrate deploy` on boot),
  workers, scraper (browsers deferred until Phase D — noted in file). **`.dockerignore` is
  load-bearing**: without it the build context ships >1GB of node_modules/.git.
- **`compose.prod.yml` + `.env.prod.example`**: full production stack, secrets validated at
  compose level (`:?` guards), infra ports internal-only.
- **CI (GitHub Actions)**: npm ci → shared build → prisma generate → API build → workers
  typecheck → jest; second job builds both Docker images on GitHub runners.
- **`docs/DEPLOY.md`**: VPS runbook — provision, docker install, deploy, verify, update,
  nightly pg_dump rotation. Deploy = `git clone && cp .env.prod.example && docker compose up`.

Honest note: local Docker image builds couldn't complete on this machine tonight (Docker Hub
pulls crawling); the CI docker job is the verification path — check the Actions tab after this
push. Blocked on Suyash: VPS purchase (~$5/mo), optional paid Gemini, Telegram bot token,
GitHub repo rename to CareerOS.

### 🚀 DEPLOYED TO PRODUCTION — 2026-07-07

DigitalOcean droplet (1 vCPU / 2GB / Bangalore), guided command-by-command with Suyash driving
the terminal. Full annotated walkthrough: docs/DEPLOY_WALKTHROUGH.md. Summary:

- Hardening: kernel update+reboot, 2GB swap (swappiness 10), Docker + daemon log rotation,
  UFW (SSH+3001), Fail2Ban (systemd backend — banned 2 IPs within minutes of the droplet
  existing), unattended-upgrades, nightly pg_dump cron (7-day rotation).
- Two build bugs found+fixed live (both pushed): prisma.config.ts demanded DATABASE_URL at
  build time (fixed with dummy-URL fallback for clean-room builds); workers image missed
  workspace-NESTED node_modules — npm nests exact-pinned deps (ioredis) under the workspace,
  Dockerfile only copied root (fixed).
- Gotcha: `--env-file .env.prod` needed on EVERY compose invocation (even ps/logs).
- First-boot data load done remotely against the public API: user registered, resume uploaded
  (vision-fallback parse worked on prod: 15 skills), YC seed 400, discovery kicked.
- **Within minutes of going live, autonomously:** boards crawl ran, 100 jobs ingested, 93
  companies flywheel-created, 12 already MONITORED. 399 YC companies converting at 25/10min.
- Telegram channel verified end-to-end (delivery confirmed to Suyash's phone).
- State: 5 containers healthy, schedulers ticking (crawl 15m / discovery 10m / boards 24h),
  system requires zero human input from here.

Minor items logged: board-discovered companies show discoverySource=null (grouped as
"manual" in funnel stats) — findOrCreateFromBoard should stamp the source; auth needs a
change-password endpoint (Suyash's password transited chat during guided setup).

### Phase status

| Phase | Status |
|---|---|
| 1 Architecture | ✅ 2026-07-06 |
| 2 Database | ✅ 2026-07-06 |
| 3 Backend (auth, resume upload/parsing, core API) | ✅ 2026-07-06 (email verify + OAuth deferred, need creds) |
| 4 Crawler | ✅ 2026-07-06 (1,307 real jobs live) |
| 5 AI matching (core) | ✅ 2026-07-06 — resume parsing w/ vision fallback, embeddings, two-stage matching E2E-verified (85% Stripe match with honest reasoning). Tailored resume/cover letter/interview prep/salary est. = Phase 5.5 |
| 6 Dashboard | pending |
| 7 Testing | pending |
| 8 Deployment | pending |

Process rule (from the project brief): **each phase needs explicit approval before the next one
starts.** Claude acts as technical co-founder — explains the "why" before implementing, challenges
assumptions, prefers long-term maintainability over quick hacks.

---

## 2026-07-07 — New machine setup (laptop swap)

Old laptop returned; its `D:\Work` folder was carried over on an external Seagate disk (mounts
as `D:` on the new PC). What was recovered from it:

- **`D:\Work\JobIntel`** — the old laptop's working copy (same HEAD `7227f50`, clean, nothing
  unpushed). Its `apps/api/.env` and `apps/workers/.env` were the carried secrets; restored
  into the new clone. `apps/scraper/.env` recreated from example with the shared
  `INTERNAL_API_TOKEN`.
- **`D:\Work\AmayaLife`** — interview-prep repo with *unpushed* local notes; copied to
  `C:\Work\AmayaLife` so it doesn't live only on the external disk.
- The `d--AmayaLife` folder Suyash dropped into the clone was old session *scratchpads*
  (temp files, screenshots) — no transcripts, nothing needed; the repo docs are the memory.

**Repo location on this PC: `C:\Work\CareerOS`.** Deliberately NOT the OneDrive Desktop
(sync churn + locked-file errors on node_modules/Prisma engines) and NOT the external `D:`
(unplug it and the dev stack dies). Same reasoning as old laptop's plain-drive layout.

Machine setup performed: Node v24 was preinstalled; installed Python 3.12, WSL2 2.7.10 and
Docker Desktop via winget (elevated). npm install + `@careeros/shared` build verified.
**Reboot required** before Docker works (VirtualMachinePlatform).

Gotchas / follow-ups:

1. **SSH keys don't transfer.** New keypair generated on this PC
   (`~/.ssh/id_ed25519.pub`, comment `suyash-new-laptop-2026-07`); public key must be added
   to `root@139.59.15.220:~/.ssh/authorized_keys` (DigitalOcean console or password login)
   before server ops work from here.
2. Prod verified healthy from this machine via `http://139.59.15.220:3001/api/health`
   (public endpoint) — VPS ran autonomously through the entire laptop swap, as designed.
3. GitHub repo was renamed from JobIntel but to the misspelled **"CarrerOs"** — rename to
   "CareerOS" still pending (old URLs redirect, so it's safe to do anytime).

---

## 2026-07-07/08 — Production incident: silent notifications + AI layer hardening

### Incident: no Telegram notifications after ~2:40pm IST

Root cause was **two compounding issues, neither a delivery failure** (test send verified
the channel live):

1. **Gemini free-tier daily quota exhausted at 3:16pm IST.** Initial ingest ballooned to
   5,276 jobs / 492 companies; embedding stopped at exactly 999 jobs (≈ the ~1,000/day
   free-tier cap) and every AI call 429'd in retry loops for 8+ hours. 4,277 jobs sat
   unembedded → unmatched → unnotifiable.
2. **Nothing scored ≥ 70 anyway.** Best of the 58 scored matches was 66 vs
   NOTIFY_MIN_SCORE=70. Partly honest gaps (Java/GCP roles), partly a handicapped input:
   the prod resume was vision-parsed to only 15 skills — **JavaScript, TypeScript,
   MongoDB, Next.js, Docker all missing** — so resumeFit (weight 35) was systematically
   depressed. **Suyash: re-export the resume as a text-based PDF (Google Docs, not
   Canva) and upload as a new version.**

Also corrected a wrong assumption from the handoff brief: the droplet itself was created
2026-07-07 ~11am IST and the whole deploy ran 1:23–2:38pm IST from the old laptop. The
"notifications until 2pm" were the deploy-time burst; prod never sent a real match
notification (notifications table was empty).

Ops changes applied on prod (via SSH from new machine):

- `NOTIFY_MIN_SCORE` 70 → **60** (temporary, to see near-miss matches while scoring is
  tuned; raise back later).
- **Deleted rogue account** `suyashtripathi2102@gmail.com` — the first deploy-time
  registration curl ran with the placeholder unreplaced, creating a real account with
  literal password `YOUR_PASSWORD_HERE` on the public API.
- Scrubbed the real password from `/root/.bash_history` (change-password endpoint remains
  Phase D item #5).
- **Suyash: enable billing on the Google AI project** (aistudio.google.com) — free tier
  cannot sustain this scale; paid tier clears the backlog in under an hour for a few
  dollars a month. Provider comparison done: OpenAI is ~10× cheaper on embeddings
  ($0.02/M vs $0.20/M) and ~2× on scoring, but migration costs a re-embed + provider
  class — revisit with real usage data, not tonight. Anthropic sells no embeddings API,
  so Claude-only is impossible for this system.

### AI layer hardening (pre-Phase-D, per external architecture review)

The review asked for provider-agnostic interfaces + env switching + caching — most of
which already existed (LlmProvider interface, AI_PROVIDER factory, DB-level embedding
caching). Implemented the genuinely missing parts:

1. **Split `EmbeddingProvider` from `LlmProvider`** (`modules/ai/llm.provider.ts`) with
   independent DI tokens. New optional envs `LLM_PROVIDER` / `EMBEDDING_PROVIDER`, both
   falling back to `AI_PROVIDER` — the two workloads have separate vendor markets, so
   they must be swappable separately (e.g. OpenAI embeddings + Gemini scoring later).
2. **AI usage accounting**: `ai_usage` table (migration
   `20260707183248_add_ai_usage_tracking`) — one row per call: kind, model, items,
   tokens, estimated cost (static price table; vendor invoice is authoritative), ok/error,
   latency. `GET /api/ai/usage` (JWT) returns today + month aggregates. No more guessing
   what CareerOS costs to run.
3. **Quota circuit breaker** in GeminiProvider: when 429 retries exhaust, the circuit
   opens for `AI_QUOTA_COOLDOWN_MS` (default 10 min) and calls fail fast with
   `QuotaExhaustedError` instead of hammering a dead quota for hours (yesterday's exact
   failure mode). BullMQ backoff naturally re-tries after cooldown.

E2E-verified locally: migration applied, API boots with new DI wiring, `/api/ai/usage`
returns aggregates. Failure-path recording + breaker get their first real exercise on
prod after the next deploy. Deliberately NOT built (YAGNI until a second provider or real
volume exists): provider factory with 6 vendor plugins, priority queue tiers, prompt
versioning.

---

## 2026-07-08 — Vertex AI migration (code complete, awaiting GCP credentials)

Approved plan: move AI calls from Gemini **Developer API** (prepaid-only since Mar 2026,
trial credits excluded) to **Vertex AI** (bills to Google Cloud → Suyash's ₹28,321 trial
credits apply; identical models + per-token prices). Full runbook incl. GCP setup,
re-embed, validation, rollback, benchmarks: **docs/VERTEX_MIGRATION.md**.

Implemented:

1. **`VertexGeminiProvider`** (`modules/ai/vertex-gemini.provider.ts`) — implements both
   `LlmProvider` + `EmbeddingProvider`. Service-account OAuth2 via `google-auth-library`
   (new api dep); regional endpoint from `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`;
   embeddings via `:predict` (`VERTEX_EMBED_BATCH_SIZE` default 1 — gemini-embedding
   models cap instances/request low on Vertex); same quota circuit + ai_usage recording
   as the Developer-API provider (records as provider "vertex").
2. **Both providers stay selectable**: `AI_PROVIDER=gemini|vertex` (or per-workload
   `LLM_PROVIDER`/`EMBEDDING_PROVIDER`). Verified locally: boots + reports correctly
   under both. **Prod default remains `gemini` — flipping is an .env.prod change.**
   Gotcha fixed: compose `${VAR:-}` yields empty strings, which ConfigService returns
   instead of defaults → provider selection uses `||` fall-through, not config defaults.
3. **`EmbeddingProvider.embeddingModelId`** — inserts now stamp the provider's actual
   model instead of hardcoded `'gemini-embedding-2'` strings (matching + resumes).
4. **Dashboard**: `GET /api/ai/usage` now reports active providers/models, per-row
   avgLatencyMs, and an errorsByCode breakdown (per today/month). Credits balance is
   not queryable via API — Console → Billing → Credits.
5. compose.prod.yml: vertex envs passed through + `./secrets:/secrets:ro` mount
   (gitignored) for the SA key. Backward compatible when unset.

**Blocked on Suyash (VERTEX_MIGRATION.md §1):** GCP project linked to the credit-holding
billing account, Vertex AI API enabled, service account (`roles/aiplatform.user`), JSON
key → `/root/careeros/secrets/vertex-sa.json` (chmod 600). Then §2 flip + §3 re-embed
(backup→wipe→backfill→validate→drop, ~$0.55 against credits) + §6 benchmark via ai_usage.
