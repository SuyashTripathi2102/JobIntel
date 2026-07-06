# Architecture Decision Records

Major choices, why they were made, and what would change them. Newest last.
(Interview-prep note: each of these is a conversation, not a bullet point.)

## ADR-1: Modular monolith, not microservices

**Decision:** Three deployable units — Next.js frontend, NestJS API (owns Prisma/schema, runs
AI queue processors), Node crawl workers (+ Python scraper as a satellite for hard targets).

**Why:** One developer. Microservices trade code-boundary problems for operational problems
(deploys, service discovery, distributed tracing, versioned contracts) — a bad trade until team
boundaries force it. NestJS modules + the internal-API seam give the same logical separation.
**Would change if:** multiple people own different domains, or AI processing load starts
starving API latency (then: split AI processors into a 4th process — one-day job, seam exists).

## ADR-2: Single-writer ingest (workers never touch Postgres)

**Decision:** Crawlers/scraper POST normalized data to token-guarded internal API endpoints;
only the API (Prisma) writes to the database.

**Why:** One schema owner = no drift between Node and Python data access; dedupe/validation/
accounting logic lives in exactly one place; workers stay stateless and horizontally scalable.
**Cost:** an HTTP hop per sync (negligible at our volume, batched anyway).

## ADR-3: BullMQ + Redis for all orchestration

**Decision:** Every background operation is a queue job (crawl fan-out, per-company crawls,
board ingest, discovery probes, seeds, embeddings, matching, intelligence derivation).

**Why:** Retries with backoff, concurrency control, repeatable schedulers, and cross-language
consumers (Python `bullmq` speaks the same Redis protocol) — all for free. Learned the hard
way (see PROJECT_LOG): static jobIds dedupe concurrent runs, but finished jobs must be removed
(`removeOnComplete/Fail: true`) or re-adds are silently ignored and schedules become no-ops.

## ADR-4: Postgres + pgvector for everything (no separate vector DB)

**Decision:** Relational data and embeddings in one Postgres; HNSW indexes via hand-written
migrations (Prisma can't express them — nor generated columns: `@default(dbgenerated())` +
`@@index(type: Gin)` keep its diff engine from fighting hand-managed SQL).

**Why:** One database to run/backup; similarity search joins directly against business tables
(match = one SQL query). A dedicated vector DB adds sync complexity for zero benefit below
millions of vectors.

## ADR-5: Two-stage matching (vector prefilter → LLM deep scoring)

**Decision:** pgvector cosine similarity ranks ALL jobs cheaply; only the top ~15 get LLM
scoring, in batched calls.

**Why:** LLM-scoring every user×job pair is economically impossible and unnecessary — the
embedding space already knows a Bangalore backend dev shouldn't be scored against a Boston
nurse posting. Cost scales with matches, not corpus size.

## ADR-6: Discovery lifecycle + Confidence Score

**Decision:** Companies move DISCOVERED → WEBSITE_VERIFIED → CAREER_PAGE_FOUND → MONITORED
(or UNRESOLVABLE with monthly retry), carrying a 0-100 confidence from weighted signals
(websiteVerified 15, careerPageFound 20, atsDetected 25, jobsExtracted 25, monitoringHealthy 15).

**Why:** The success metric is *conversion to monitored*, not discovery count — a company we
can't monitor is a contact-list entry. Confidence signals debug the funnel: the SmartRecruiters
false-positive incident surfaced precisely as "atsDetected=true, jobsExtracted=false" rows.
**Key sub-decision:** ATS probes must validate *response shape* per provider (SmartRecruiters
200s with `totalFound:0` for any slug; Breezy 302s on unknown tenants), never just HTTP status.

## ADR-7: Tiered crawling, not uniform refresh

**Decision:** `crawlTier` (HOT 30m / WARM 4h / COLD 24h) + `nextCrawlAt` per company; a 15-min
scheduler fans out only due companies; failures back off 1h; tier bumps after every sync.

**Why:** "Notify within minutes" is only affordable for companies that matter (applied-to,
followed, high match density); the long tail needs daily at most. Uniform frequency either
starves the head or hammers the tail.

## ADR-8: ToS red lines

**Decision:** No LinkedIn/Indeed scraping ever (their alert emails + the fact that postings
originate on ATS boards cover the gap); no auto-apply (assistant model: prepare everything,
human reviews and submits); robots.txt respected; UA identifies the crawler honestly.

**Why:** Legal/ethical floor, and product quality — blast-applying lowers callback rates, and
a portfolio project centered on ToS violations is a negative signal, not a feature.

## ADR-9: Company intelligence derives from our own corpus first

**Decision:** Tech stack, remote/visa/junior-friendliness, experience profile, role mix, salary
medians, hiring velocity — all computed from jobs we already crawled (LLM extraction + SQL),
not from scraping Glassdoor/Crunchbase/etc.

**Why:** Free, legal, always fresh, and surprisingly complete — a company's job postings ARE
its hiring profile. External sources (funding, ratings) come later as links/references only.

## ADR-10: Opportunity Score will be modular scorers, not one formula (Phase C)

**Decision (planned):** Independent scorer modules (resume fit, experience match, freshness,
remote/salary preference fit, company quality, hiring velocity, skill gap), each returning
score + reason, combined by configurable weights. Notifications carry the per-module reasons
("92% resume match · posted 14 min ago · remote · docker missing").

**Why:** Each factor evolves independently (velocity needs history; company quality needs B.5
data); per-module reasons make notifications actionable; weights become *tunable from outcome
data* once Application Analytics exists (which resume/scoring emphasis actually yields
interviews — the Resume Version Intelligence feedback loop).
