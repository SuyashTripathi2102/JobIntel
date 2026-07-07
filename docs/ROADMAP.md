# CareerOS Roadmap — from AI crawler to AI recruiter

> Adopted 2026-07-08 after product review (Suyash + two AI reviews, merged).
> Supersedes the Phase D scope in the PROJECT_LOG handoff brief. The
> infrastructure era is over; every feature now answers ONE question:
> **"Does this help me get interviews faster?"**

## North star — the five questions

Every opportunity CareerOS surfaces must answer:

1. **Should I apply?** (verdict, not a bare score)
2. **How likely am I to get an interview?** (honest bands until outcome data exists)
3. **What is stopping me?** (explicit gaps, scannable)
4. **Can I improve before applying?** (strategy: apply now vs. learn X first)
5. **Who can help me?** (referral/contact paths from public sources)

The JOB is evidence. The OPPORTUNITY — with a decision attached — is the product.

## Non-negotiable principles

- **Decisions over information.** A notification must be actionable in <10s.
- **Never fabricate numbers.** No invented salaries, no fake "78% interview
  probability". Qualitative bands + visible reasoning until the tracker
  provides real outcome data (Phase F unlocks honest percentages).
- **Public information only for people.** LinkedIn/Indeed scraping is
  permanently out of scope (ToS — day-one decision). Contact discovery uses
  harvested public emails, team pages, GitHub, blogs.
- **Individually-reviewed only, never bulk.** Applies to outreach AND future
  auto-apply (assistive drafting, human sends).
- **Geography-aware, India-first (current user preference).** Supply must
  match: decisions over a US-heavy pool don't fill an Indian funnel.

## Phase D — Decision Engine & Reach

1. **Decision layer + notification redesign** — APPLY / CONSIDER / SKIP verdict
   (rule-based over existing scores; LLM `reasoning` as explanation), visual
   score (🟢/🟡/🔴 NN/100), strengths ✔ / missing ❌ lists, freshness tiers
   (🔥 today / 🟡 this week / ⚪ stale), salary shown only when listed (with
   source), twin-posting hint (Brigit "66×2" lesson), geography tiers
   (India city > India remote > hidden), URL buttons (Apply, Careers page).
2. **India-first discovery sources** — city-based company discovery
   (Indore/Pune/Bangalore/Hyderabad/NCR), Indian companies' ATS boards.
   Fixes the supply problem (only ~250/5,291 jobs India-relevant today).
3. **Contact & referral subsystem** (public sources) — prober harvests
   mailto:/jobs@/careers@ (already approved), team pages, GitHub org members,
   engineering-blog authors → `Company.contactEmails` + contacts surface in
   notifications ("Referral path: 2 public contacts").
4. **Bot interactivity + Company Report** — Telegram callback buttons
   (Skip/Save/Report; needs bot update polling), `/report` = company overview,
   **hiring timeline** (firstSeenAt/lastSeenAt/REMOVED analytics — the
   already-approved timeline item), crawl-health-as-confidence explained in
   words, tech stack from job_skills, openings by function.
5. **Application strategy** — "Apply today + referral recommended" vs.
   "Learn Docker first (~2 days), then apply" — rule-based v1 from skill-gap
   + freshness + competition signals.
6. **Applications tracker** (moved UP from Phase E — it is the data collector
   the learning engine depends on; schema has existed since Phase 2) —
   create-from-job, status transitions, ApplicationEvent timeline, stats.
7. Small fixes: POST /auth/change-password; findOrCreateFromBoard stamps
   discoverySource; scheduled rescore sweep (threshold changes must not
   strand qualifying matches).

## Phase E — Apply Better

0. **Dashboard v1** (pulled forward deliberately): today's high-priority
   opportunities, hiring-velocity movers, top missing skill, referral
   opportunities, applications awaiting follow-up, funnel stats. Doubles as
   ops visibility (crawler/matcher health).
1. Resume versioning UX + tailored resume per application (Phase 5.5 items).
2. Cover letter drafts (individually reviewed, never auto-sent).
3. Interview prep per company (from job description + company intelligence).

## Phase F — Learning Engine (unlocked by tracker data)

- Outcome learning: which resume versions / strategies convert to interviews.
- **Skill intelligence**: "Docker: 183 companies, 2,918 jobs, +11% median
  opportunity score if learned" — demand counts are SQL over job_skills;
  score uplift is the approved "+X%" recompute; study-time stays a rough
  heuristic, honestly labeled.
- Honest interview-probability percentages (now backed by data).
- Hiring/company/resume analytics.

## Phase G — Reach & Automation (ethos-guarded)

- Browser extension: autofill applications (assistive), page-context
  company reports.
- Email scanner: application status detection → tracker auto-updates.
- Auto-apply = **draft-and-review**, never fire-and-forget.

## Phase H — CareerOS beyond one user

- Multi-resume, multi-user, teams; recruiter-side CRM; premium tiers.

## Explicitly rejected / deferred

- LinkedIn/Indeed scraping & connection graphs — permanent ToS exclusion.
- Salary *estimation* without data — show listed or "Not listed".
- Fake interview percentages before Phase F.
- Per-field job-change events (needs ingest job_events table — deferred,
  batched upsert makes old-vs-new comparison nontrivial).
