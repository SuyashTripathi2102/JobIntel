import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { countrySql } from './location-filter';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from '../ai/llm.provider';
import type { EmbeddingProvider, LlmProvider } from '../ai/llm.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { OpportunityService } from '../opportunity/opportunity.service';
import type { ParsedResume } from '../resumes/resume-intelligence.service';

const SIMILARITY_TOP_K = 40; // pgvector prefilter size
const LLM_SCORE_TOP_N = 15; // how many get deep LLM scoring
const SCORE_BATCH = 5; // jobs per LLM call (free-tier RPM friendly)
const MIN_SIMILARITY = 0.45; // incremental path: below this, don't spend LLM calls
// Reconciliation only evaluates jobs a human could still act on. Beyond this,
// listings are overwhelmingly zombies (audit: 51% of the India pool is 90d+).
const RECONCILE_MAX_AGE_DAYS = 45;

interface JobScore {
  jobId: string;
  overallScore: number;
  technicalScore: number;
  experienceScore: number;
  missingSkills: string[];
  reasoning: string;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
    private readonly opportunity: OpportunityService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Stage 0: ensure every ACTIVE job has an embedding (batched backfill).
   * Stage 1: pgvector cosine similarity — cheap prefilter over ALL jobs.
   * Stage 2: LLM deep-scores the top candidates against the parsed resume.
   */
  async generateForUser(userId: string): Promise<{ matched: number; scanned: number }> {
    const resume = await this.getPrimaryResumeContext(userId);
    const countries = await this.preferredCountries(userId);

    // Backfill is best-effort: chunks persist as they finish, so if quota
    // runs dry we score with what's embedded and complete coverage next run.
    try {
      const embedded = await this.backfillJobEmbeddings();
      if (embedded > 0) this.logger.log(`Backfilled ${embedded} job embeddings`);
    } catch (err) {
      this.logger.warn(
        `Embedding backfill stopped early (${err instanceof Error ? err.message.slice(0, 120) : err}) — matching with existing embeddings`,
      );
    }

    const candidates = await this.similarJobs(resume.resumeVersionId, SIMILARITY_TOP_K, countries);
    this.logger.log(`Prefilter: ${candidates.length} candidates by cosine similarity`);

    const toScore = candidates.slice(0, LLM_SCORE_TOP_N);
    const matchIds = await this.scoreAndUpsert(userId, resume, toScore);

    // Opportunity scoring + notification (memory prevents bulk-run spam).
    for (const id of matchIds) {
      await this.opportunity.scoreMatch(id);
      await this.notifications.maybeNotifyMatch(id);
    }

    return { matched: matchIds.length, scanned: candidates.length };
  }

  /**
   * Incremental path (Phase C): freshly ingested+embedded jobs get matched
   * against every user with a parsed primary resume, scored, and — if they
   * clear the bar — pushed as a notification within the crawl tier's latency.
   */
  async matchNewJobs(jobIds: string[]): Promise<{ notified: number; matched: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        resumes: { some: { isPrimary: true, versions: { some: { embedding: { isNot: null } } } } },
      },
      select: { id: true },
    });

    let matched = 0;
    let notified = 0;
    for (const user of users) {
      let resume;
      try {
        resume = await this.getPrimaryResumeContext(user.id);
      } catch {
        continue; // resume not parsed yet
      }

      const countries = await this.preferredCountries(user.id);
      const candidates = await this.prisma.$queryRaw<
        { id: string; title: string; description: string; similarity: number }[]
      >`
        SELECT j.id, j.title, j.description,
               1 - (je.vector <=> re.vector) AS similarity
        FROM job_embeddings je
        JOIN jobs j ON j.id = je."jobId" AND j.status = 'ACTIVE'
        CROSS JOIN (SELECT vector FROM resume_embeddings WHERE "resumeVersionId" = ${resume.resumeVersionId}) re
        WHERE j.id = ANY(${jobIds})
          AND 1 - (je.vector <=> re.vector) > ${MIN_SIMILARITY}
          AND ${countrySql(countries)}
        ORDER BY je.vector <=> re.vector
        LIMIT 10
      `;
      if (candidates.length === 0) continue;

      const matchIds = await this.scoreAndUpsert(user.id, resume, candidates);
      matched += matchIds.length;
      for (const id of matchIds) {
        await this.opportunity.scoreMatch(id);
        if (await this.notifications.maybeNotifyMatch(id)) notified++;
      }
    }
    if (matched > 0) {
      this.logger.log(`Incremental: ${jobIds.length} new jobs -> ${matched} matches, ${notified} notified`);
    }
    return { matched, notified };
  }

  /**
   * Recompute opportunity scores for a user's existing matches (no LLM —
   * freshness decays, preferences change, company intel improves) and run
   * the notification gate over the results.
   */
  async rescoreExisting(userId: string): Promise<{ rescored: number; notified: number }> {
    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, job: { status: 'ACTIVE' } },
      select: { id: true },
    });
    let notified = 0;
    for (const m of matches) {
      await this.opportunity.scoreMatch(m.id);
      if (await this.notifications.maybeNotifyMatch(m.id)) notified++;
    }
    return { rescored: matches.length, notified };
  }

  /** Reconcile every user with a parsed primary resume (system-driven catch-up:
   *  runs after a resume re-parse and on a schedule). */
  async reconcileAll(cap = 60): Promise<{ users: number; scored: number; apply: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        resumes: { some: { isPrimary: true, versions: { some: { embedding: { isNot: null } } } } },
      },
      select: { id: true },
    });
    let scored = 0;
    let apply = 0;
    for (const u of users) {
      const r = await this.reconcileForUser(u.id, cap).catch((e) => {
        this.logger.error(`reconcile failed for ${u.id}: ${e instanceof Error ? e.message : e}`);
        return null;
      });
      if (r) {
        scored += r.scored;
        apply += r.apply;
      }
    }
    return { users: users.length, scored, apply };
  }

  /**
   * Reconciliation (2026-07-09): the incremental pipeline only matches jobs at
   * INGEST time. Jobs already in the DB before a resume improves — or that were
   * ingested faster than they were matched — sit unscored forever. This finds
   * active, preferred-country jobs with an embedding but NO current match,
   * ranks them by similarity to the current resume, and scores a capped batch.
   *
   * Safe by construction: idempotent (scoreAndUpsert), bounded (cap), does NOT
   * spam — only fresh APPLY verdicts notify immediately; CONSIDER jobs land in
   * the DB unnotified so the 2 PM digest picks them up.
   */
  async reconcileForUser(
    userId: string,
    cap = 60,
  ): Promise<{
    unmatchedFound: number;
    scored: number;
    apply: number;
    consider: number;
    skip: number;
    notified: number;
  }> {
    const resume = await this.getPrimaryResumeContext(userId);
    const countries = await this.preferredCountries(userId);

    // Actionable-first: only jobs a human could still act on (<= RECONCILE_MAX_AGE
    // days). 51% of the India pool is 90d+ zombie listings — ranking purely by
    // similarity burned LLM budget on ghosts while leaving fresh jobs unscored
    // (2026-07-09 audit). Coverage that matters = eligible ACTIONABLE jobs.
    const candidates = await this.prisma.$queryRaw<
      { id: string; title: string; description: string }[]
    >`
      SELECT j.id, j.title, j.description
      FROM job_embeddings je
      JOIN jobs j ON j.id = je."jobId" AND j.status = 'ACTIVE'
      CROSS JOIN (SELECT vector FROM resume_embeddings WHERE "resumeVersionId" = ${resume.resumeVersionId}) re
      WHERE ${countrySql(countries)}
        AND now()::date - COALESCE(j."postedAt", j."firstSeenAt")::date <= ${RECONCILE_MAX_AGE_DAYS}
        AND NOT EXISTS (SELECT 1 FROM job_matches m WHERE m."jobId" = j.id AND m."userId" = ${userId})
      ORDER BY je.vector <=> re.vector
      LIMIT ${cap}
    `;

    if (candidates.length === 0) {
      return { unmatchedFound: 0, scored: 0, apply: 0, consider: 0, skip: 0, notified: 0 };
    }

    const matchIds = await this.scoreAndUpsert(userId, resume, candidates);

    let apply = 0;
    let consider = 0;
    let skip = 0;
    let notified = 0;
    for (const id of matchIds) {
      const result = await this.opportunity.scoreMatch(id);
      const score = result?.opportunityScore ?? 0;
      if (score >= 75) {
        apply++;
        // Only exceptional, never-seen APPLY jobs interrupt — the gate still
        // applies its own SKIP/geo/stale/memory checks.
        if (await this.notifications.maybeNotifyMatch(id)) notified++;
      } else if (score >= 60) {
        consider++; // left unnotified — the 2 PM digest delivers these
      } else {
        skip++;
      }
    }

    this.logger.log(
      `Reconcile ${userId}: ${candidates.length} unmatched -> ${apply} APPLY (${notified} notified), ${consider} CONSIDER (for digest), ${skip} SKIP`,
    );
    return { unmatchedFound: candidates.length, scored: matchIds.length, apply, consider, skip, notified };
  }

  /**
   * "Why didn't I get notified about this job?" — reconstructs the exact
   * decision path from stored data: similarity gate, scoring, threshold,
   * board-copy hold, notification memory. Trust through explainability.
   */
  async explainNotification(userId: string, jobId: string, minScore: number) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        company: { select: { name: true, atsIdentifier: true, confidence: true } },
        embedding: { select: { id: true } },
      },
    });
    if (!job) throw new BadRequestException('Unknown job');

    const match = await this.prisma.jobMatch.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });

    const verdict = (reason: string, detail: Record<string, unknown> = {}) => ({
      job: { title: job.title, company: job.company.name },
      notified: !!match?.notifiedAt,
      reason,
      ...detail,
    });

    if (match?.notifiedAt) return verdict('You were notified.', { at: match.notifiedAt });

    if (!match) {
      if (!job.embedding) return verdict('Job is not embedded yet — pipeline still processing.');
      let resume;
      try {
        resume = await this.getPrimaryResumeContext(userId);
      } catch {
        return verdict('Your primary resume is not parsed yet.');
      }
      const [sim] = await this.prisma.$queryRaw<{ similarity: number }[]>`
        SELECT 1 - (je.vector <=> re.vector) AS similarity
        FROM job_embeddings je
        CROSS JOIN (SELECT vector FROM resume_embeddings WHERE "resumeVersionId" = ${resume.resumeVersionId}) re
        WHERE je."jobId" = ${jobId}
      `;
      const similarity = Math.round((sim?.similarity ?? 0) * 100) / 100;
      return similarity <= MIN_SIMILARITY
        ? verdict(
            `Below the similarity gate: ${similarity} vs ${MIN_SIMILARITY} required — not close enough to your resume to spend scoring on.`,
            { similarity },
          )
        : verdict(
            `Similar enough (${similarity}) but not yet deep-scored — it wasn't in the top candidates of the last run.`,
            { similarity },
          );
    }

    if (job.externalId.startsWith('remoteok-') && job.company.atsIdentifier) {
      return verdict(
        'Board copy held — this company is directly monitored; the official posting notifies instead.',
      );
    }

    if ((match.opportunityScore ?? 0) < minScore) {
      return verdict(
        `Opportunity score ${match.opportunityScore} is below your threshold ${minScore}.`,
        {
          opportunityScore: match.opportunityScore,
          threshold: minScore,
          breakdown: match.scoreBreakdown,
        },
      );
    }

    return verdict(
      'Qualifies but not yet delivered — it will notify on the next scoring pass.',
      { opportunityScore: match.opportunityScore },
    );
  }

  private async scoreAndUpsert(
    userId: string,
    resume: { resumeVersionId: string; parsed: ParsedResume },
    toScore: { id: string; title: string; description: string }[],
  ): Promise<string[]> {
    const matchIds: string[] = [];
    for (let i = 0; i < toScore.length; i += SCORE_BATCH) {
      if (i > 0) await new Promise((r) => setTimeout(r, 8_000)); // free-tier RPM pacing
      const batch = toScore.slice(i, i + SCORE_BATCH);
      const scores = await this.scoreBatch(resume.parsed, batch);
      for (const s of scores) {
        const row = await this.prisma.jobMatch.upsert({
          where: { userId_jobId: { userId, jobId: s.jobId } },
          create: {
            userId,
            jobId: s.jobId,
            resumeVersionId: resume.resumeVersionId,
            overallScore: s.overallScore,
            technicalScore: s.technicalScore,
            experienceScore: s.experienceScore,
            missingSkills: s.missingSkills,
            reasoning: s.reasoning,
          },
          update: {
            resumeVersionId: resume.resumeVersionId,
            overallScore: s.overallScore,
            technicalScore: s.technicalScore,
            experienceScore: s.experienceScore,
            missingSkills: s.missingSkills,
            reasoning: s.reasoning,
          },
          select: { id: true },
        });
        matchIds.push(row.id);
      }
    }
    return matchIds;
  }

  list(userId: string, minScore = 0) {
    return this.prisma.jobMatch.findMany({
      where: { userId, overallScore: { gte: minScore }, job: { status: 'ACTIVE' } },
      orderBy: { overallScore: 'desc' },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            url: true,
            location: true,
            workMode: true,
            salaryMin: true,
            salaryMax: true,
            currency: true,
            postedAt: true,
            company: { select: { id: true, name: true, website: true } },
          },
        },
      },
    });
  }

  private async getPrimaryResumeContext(userId: string) {
    const version = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true } },
      orderBy: { versionNumber: 'desc' },
      include: { embedding: { select: { id: true } } },
    });
    if (!version) {
      throw new BadRequestException('Upload a resume first (and mark one primary)');
    }
    const structured = (version.parsedJson as { structured?: ParsedResume } | null)?.structured;
    if (!structured || !version.embedding) {
      throw new BadRequestException(
        'Primary resume is not parsed yet — run POST /resumes/versions/:id/parse first',
      );
    }
    return { resumeVersionId: version.id, parsed: structured };
  }

  /** Embed specific jobs (embed-at-ingest path — called by EmbedProcessor). */
  async embedJobsByIds(jobIds: string[]): Promise<number> {
    const missing = await this.prisma.job.findMany({
      where: { id: { in: jobIds }, embedding: null },
      select: { id: true, title: true, description: true, location: true },
    });
    return this.embedJobs(missing);
  }

  /**
   * Embed ACTIVE jobs that don't have vectors yet, persisting after every
   * chunk — a crash or rate-limit failure mid-backfill loses at most one
   * chunk, and the next run resumes where this one stopped.
   */
  private async backfillJobEmbeddings(): Promise<number> {
    const missing = await this.prisma.job.findMany({
      where: { status: 'ACTIVE', embedding: null },
      select: { id: true, title: true, description: true, location: true },
    });
    return this.embedJobs(missing);
  }

  private async embedJobs(
    missing: { id: string; title: string; description: string; location: string | null }[],
  ): Promise<number> {
    if (missing.length === 0) return 0;

    const CHUNK = 20;
    let done = 0;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      // ~2k chars ≈ 500 tokens — similarity semantics live in the head of
      // the description, and small texts keep free-tier token limits happy.
      const texts = chunk.map((j) =>
        `${j.title}\n${j.location ?? ''}\n${j.description.slice(0, 2_000)}`.trim(),
      );
      const vectors = await this.embedder.embed(texts);

      for (let k = 0; k < chunk.length; k++) {
        const literal = `[${vectors[k].join(',')}]`;
        await this.prisma.$executeRaw`
          INSERT INTO job_embeddings (id, "jobId", model, vector, "createdAt")
          VALUES (${randomUUID()}, ${chunk[k].id}, ${this.embedder.embeddingModelId}, ${literal}::vector, now())
          ON CONFLICT ("jobId") DO NOTHING
        `;
      }
      done += chunk.length;
      if (done % 200 === 0 || done === missing.length) {
        this.logger.log(`Embedding backfill: ${done}/${missing.length}`);
      }
    }
    return missing.length;
  }

  /** Preferred countries from user preferences — [] means no restriction. */
  private async preferredCountries(userId: string): Promise<string[]> {
    const prefs = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { countries: true },
    });
    return prefs?.countries ?? [];
  }

  private async similarJobs(
    resumeVersionId: string,
    limit: number,
    countries: string[] = [],
  ): Promise<{ id: string; title: string; description: string; similarity: number }[]> {
    return this.prisma.$queryRaw`
      SELECT j.id, j.title, j.description,
             1 - (je.vector <=> re.vector) AS similarity
      FROM job_embeddings je
      JOIN jobs j ON j.id = je."jobId" AND j.status = 'ACTIVE'
      CROSS JOIN (SELECT vector FROM resume_embeddings WHERE "resumeVersionId" = ${resumeVersionId}) re
      WHERE ${countrySql(countries)}
      ORDER BY je.vector <=> re.vector
      LIMIT ${limit}
    `;
  }

  private async scoreBatch(
    resume: ParsedResume,
    jobs: { id: string; title: string; description: string }[],
  ): Promise<JobScore[]> {
    const prompt = `You are scoring how well ONE candidate fits each job below.

CANDIDATE:
${resume.summaryForMatching}
Skills: ${resume.skills.map((s) => s.name).join(', ')}
Total experience: ${resume.totalYearsExperience ?? 'unknown'} years

JOBS:
${jobs
  .map(
    (j, i) => `--- JOB ${i + 1} (id: ${j.id}) ---
${j.title}
${j.description.slice(0, 4_000)}`,
  )
  .join('\n\n')}

For EACH job return: overallScore, technicalScore, experienceScore (0-100 integers, be honest —
seniority mismatches and missing core requirements should hurt the score), missingSkills
(candidate lacks but job needs, lowercase), reasoning (2-3 frank sentences: why this fits or
doesn't, addressed to the candidate as "you").

Return JSON: {"scores":[{"jobId":string,"overallScore":number,"technicalScore":number,"experienceScore":number,"missingSkills":[string],"reasoning":string}]}`;

    const res = await this.llm.generateJson<{ scores: JobScore[] }>(prompt);
    const valid = new Set(jobs.map((j) => j.id));
    return (res.scores ?? []).filter((s) => valid.has(s.jobId));
  }
}
