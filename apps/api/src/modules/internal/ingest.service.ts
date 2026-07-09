import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CrawlStatus, CrawlTier, DiscoveryStage, JobStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { BoardJob, NormalizedJob } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { computeConfidence } from '../discovery/discovery.service';
import { EMBED_JOBS_QUEUE } from './internal.constants';

export interface SyncResult {
  crawlRunId: string;
  found: number;
  created: number;
  updated: number;
  removed: number;
}

/** Tier → how long until the next crawl after a successful sync. */
const TIER_INTERVAL_MS: Record<CrawlTier, number> = {
  HOT: 30 * 60 * 1000, // 30 min
  WARM: 4 * 60 * 60 * 1000, // 4 h
  COLD: 24 * 60 * 60 * 1000, // 24 h
};
const FAILURE_BACKOFF_MS = 60 * 60 * 1000; // failed company retries in 1h, not hot-loop

const UPSERT_CHUNK = 500;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    @InjectQueue(EMBED_JOBS_QUEUE) private readonly embedQueue: Queue,
  ) {}

  /**
   * Full-board sync for one company: batched upsert of what the crawler saw,
   * mark what disappeared as REMOVED, record a CrawlRun, bump nextCrawlAt by
   * tier, enqueue embeddings for genuinely new jobs. Never deletes — history
   * is a feature (application tracker's "position filled" signal).
   */
  async syncCompanyJobs(
    companyId: string,
    source: string,
    jobs: NormalizedJob[],
  ): Promise<SyncResult> {
    const run = await this.prisma.crawlRun.create({
      data: { companyId, source, status: CrawlStatus.RUNNING },
    });

    try {
      const { created, updated, newJobIds } = await this.batchUpsert(companyId, jobs);

      // Anything ACTIVE we did NOT see this run has been taken down.
      const seenIds = jobs.map((j) => j.externalId);
      const { count: removed } = await this.prisma.job.updateMany({
        where: {
          companyId,
          status: JobStatus.ACTIVE,
          externalId: { notIn: seenIds },
        },
        data: { status: JobStatus.REMOVED },
      });

      await this.prisma.crawlRun.update({
        where: { id: run.id },
        data: {
          status: CrawlStatus.SUCCEEDED,
          finishedAt: new Date(),
          jobsFound: jobs.length,
          jobsNew: created,
          jobsRemoved: removed,
        },
      });

      await this.bumpNextCrawl(companyId, /* failed */ false);
      await this.updateConfidenceAfterCrawl(companyId, jobs.length > 0);
      await this.enqueueEmbeddings(newJobIds);

      return { crawlRunId: run.id, found: jobs.length, created, updated, removed };
    } catch (err) {
      await this.prisma.crawlRun.update({
        where: { id: run.id },
        data: {
          status: CrawlStatus.FAILED,
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        },
      });
      await this.bumpNextCrawl(companyId, /* failed */ true);
      throw err;
    }
  }

  /**
   * Board ingest (RemoteOK, HN...): jobs arrive with company info instead of
   * a companyId. Companies are found-or-created — the discovery flywheel.
   * No removed-detection here: a job leaving a board says nothing about the
   * company's own career page.
   */
  async ingestBoardJobs(source: string, entries: BoardJob[]): Promise<SyncResult> {
    const run = await this.prisma.crawlRun.create({
      data: { source, status: CrawlStatus.RUNNING },
    });

    let created = 0;
    let updated = 0;
    let failures = 0;
    const newJobIds: string[] = [];

    // Group by company so each company's jobs go through one batched upsert.
    const byCompany = new Map<string, { entry: BoardJob['company']; jobs: NormalizedJob[] }>();
    for (const e of entries) {
      const key = e.company.name.toLowerCase();
      const bucket = byCompany.get(key) ?? { entry: e.company, jobs: [] };
      bucket.jobs.push(e.job);
      byCompany.set(key, bucket);
    }

    for (const { entry, jobs } of byCompany.values()) {
      try {
        const company = await this.companies.findOrCreateFromBoard(entry);
        const res = await this.batchUpsert(company.id, jobs);
        created += res.created;
        updated += res.updated;
        newJobIds.push(...res.newJobIds);
      } catch (err) {
        failures++;
        this.logger.warn(
          `Board ingest skipped ${jobs.length} job(s) @ ${entry.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    await this.prisma.crawlRun.update({
      where: { id: run.id },
      data: {
        status: failures === 0 ? CrawlStatus.SUCCEEDED : CrawlStatus.PARTIAL,
        finishedAt: new Date(),
        jobsFound: entries.length,
        jobsNew: created,
        error: failures > 0 ? `${failures} companies failed` : null,
      },
    });

    await this.enqueueEmbeddings(newJobIds);
    return { crawlRunId: run.id, found: entries.length, created, updated, removed: 0 };
  }

  /**
   * One INSERT ... ON CONFLICT round trip per chunk instead of 2 queries per
   * job — the difference between 10 minutes and 5 seconds at 10k jobs/day.
   * `xmax = 0` distinguishes fresh inserts from conflict-updates.
   */
  private async batchUpsert(
    companyId: string,
    jobs: NormalizedJob[],
  ): Promise<{ created: number; updated: number; newJobIds: string[] }> {
    let created = 0;
    let updated = 0;
    const newJobIds: string[] = [];

    // Dedupe by externalId within this crawl: Workable (and others) list the
    // same shortcode twice for multi-location postings. Postgres ON CONFLICT
    // can't update one row twice in a statement — an un-deduped batch fails
    // ENTIRELY, silently dropping every job from that company (2026-07-09:
    // 45 Workable crawls/day failing this way). Keep first occurrence.
    const seen = new Set<string>();
    const deduped = jobs.filter((j) => {
      if (seen.has(j.externalId)) return false;
      seen.add(j.externalId);
      return true;
    });

    for (let i = 0; i < deduped.length; i += UPSERT_CHUNK) {
      const chunk = deduped.slice(i, i + UPSERT_CHUNK);

      const ids = chunk.map(() => randomUUID());
      const externalIds = chunk.map((j) => j.externalId);
      const titles = chunk.map((j) => j.title);
      const descriptions = chunk.map((j) => j.description ?? '');
      const urls = chunk.map((j) => j.url);
      const locations = chunk.map((j) => j.location ?? null);
      const countries = chunk.map((j) => j.country ?? null);
      const workModes = chunk.map((j) => j.workMode ?? null);
      const salaryMins = chunk.map((j) => j.salaryMin ?? null);
      const salaryMaxs = chunk.map((j) => j.salaryMax ?? null);
      const currencies = chunk.map((j) => j.currency ?? null);
      const postedAts = chunk.map((j) => j.postedAt ?? null);

      const rows = await this.prisma.$queryRaw<{ id: string; inserted: boolean }[]>`
        INSERT INTO jobs (
          id, "companyId", "externalId", title, description, url,
          location, country, "workMode", "salaryMin", "salaryMax", currency,
          "postedAt", status, "firstSeenAt", "lastSeenAt"
        )
        SELECT
          u.id, ${companyId}, u.external_id, u.title, u.description, u.url,
          u.location, u.country, u.work_mode::"WorkMode", u.salary_min, u.salary_max, u.currency,
          u.posted_at::timestamptz, 'ACTIVE', now(), now()
        FROM unnest(
          ${ids}::text[], ${externalIds}::text[], ${titles}::text[],
          ${descriptions}::text[], ${urls}::text[], ${locations}::text[],
          ${countries}::text[], ${workModes}::text[], ${salaryMins}::int[],
          ${salaryMaxs}::int[], ${currencies}::text[], ${postedAts}::text[]
        ) AS u(
          id, external_id, title, description, url, location,
          country, work_mode, salary_min, salary_max, currency, posted_at
        )
        ON CONFLICT ("companyId", "externalId") DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          url = EXCLUDED.url,
          location = EXCLUDED.location,
          country = EXCLUDED.country,
          "workMode" = EXCLUDED."workMode",
          "salaryMin" = EXCLUDED."salaryMin",
          "salaryMax" = EXCLUDED."salaryMax",
          currency = EXCLUDED.currency,
          "postedAt" = EXCLUDED."postedAt",
          status = 'ACTIVE',
          "lastSeenAt" = now()
        RETURNING id, (xmax = 0) AS inserted
      `;

      for (const r of rows) {
        if (r.inserted) {
          created++;
          newJobIds.push(r.id);
        } else {
          updated++;
        }
      }
    }

    return { created, updated, newJobIds };
  }

  /**
   * Post-crawl confidence maintenance: jobsExtracted once we've ever pulled
   * jobs, monitoringHealthy from the recent success rate. Weights live in
   * discovery.service.ts (computeConfidence) — duplicated intentionally NOT:
   * we import it.
   */
  private async updateConfidenceAfterCrawl(companyId: string, gotJobs: boolean): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { confidenceSignals: true },
    });
    const recent = await this.prisma.crawlRun.findMany({
      where: { companyId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: { status: true },
    });
    const successes = recent.filter((r) => r.status === CrawlStatus.SUCCEEDED).length;
    const healthy = recent.length > 0 && successes / recent.length >= 0.7;

    const prev = (company?.confidenceSignals ?? {}) as Record<string, unknown>;
    const signals = {
      ...prev,
      websiteVerified: prev.websiteVerified === true,
      careerPageFound: true, // it's syncing a board — the page evidently exists
      atsDetected: true,
      jobsExtracted: prev.jobsExtracted === true || gotJobs,
      monitoringHealthy: healthy,
    };
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        discoveryStage: DiscoveryStage.MONITORED,
        confidence: computeConfidence(signals),
        confidenceSignals: signals as object,
      },
    });
  }

  private async bumpNextCrawl(companyId: string, failed: boolean): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { crawlTier: true },
    });
    const interval = failed
      ? FAILURE_BACKOFF_MS
      : TIER_INTERVAL_MS[company?.crawlTier ?? CrawlTier.WARM];
    await this.prisma.company.update({
      where: { id: companyId },
      data: { nextCrawlAt: new Date(Date.now() + interval) },
    });
  }

  /** New jobs get embedded in the background — the incremental-matching path. */
  private async enqueueEmbeddings(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    for (let i = 0; i < jobIds.length; i += 100) {
      await this.embedQueue.add(
        'embed',
        { jobIds: jobIds.slice(i, i + 100) },
        { removeOnComplete: true, removeOnFail: true, attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
      );
    }
  }
}
