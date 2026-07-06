import { Worker, Queue } from 'bullmq';
import { QueueNames } from '../queues/names';
import { createRedisConnection } from '../queues/connection';
import { ApiClient } from '../api-client';
import type { CrawlCompanyJobData } from './crawl-company.processor';
import type { CrawlBoardJobData } from './crawl-board.processor';

/**
 * The fan-out step: one "refresh" tick (15 min repeatable, or manual via
 * POST /crawl/trigger) becomes one crawl-company job per DUE company.
 * Per-company failures retry independently and never block the rest.
 */
export function startRefreshAllWorker(api: ApiClient): Worker {
  // removeOnComplete/Fail = true is deliberate: we reuse static jobIds
  // (crawl-<companyId>) to dedupe *concurrent* runs, and BullMQ silently
  // ignores an add whose jobId still exists in ANY state — keeping finished
  // jobs around would turn every future tick into a no-op. Crawl history
  // lives in Postgres (crawl_runs), not Redis.
  const companyQueue = new Queue<CrawlCompanyJobData>(QueueNames.CRAWL_COMPANY, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  return new Worker(
    QueueNames.REFRESH_ALL,
    async () => {
      // The API returns only companies whose nextCrawlAt has passed — the
      // tick is frequent (15 min) but each company's cadence is its tier's.
      const companies = await api.getCompaniesDue();
      if (companies.length === 0) return { companies: 0 };

      await companyQueue.addBulk(
        companies.map((c) => ({
          name: c.name,
          data: {
            companyId: c.id,
            companyName: c.name,
            atsProvider: c.atsProvider,
            atsIdentifier: c.atsIdentifier,
          },
          // If a previous tick's job for this company is still queued, skip the dupe.
          opts: { jobId: `crawl-${c.id}` },
        })),
      );

      console.log(`[refresh-all] fanned out ${companies.length} due companies`);
      return { companies: companies.length };
    },
    { connection: createRedisConnection() },
  );
}

/** Idempotent schedulers: due-companies tick every 15 min, boards daily. */
export async function ensureRefreshSchedule(): Promise<void> {
  const refreshQueue = new Queue(QueueNames.REFRESH_ALL, {
    connection: createRedisConnection(),
  });
  await refreshQueue.upsertJobScheduler(
    'refresh-due-15m',
    { every: 15 * 60 * 1000 },
    { name: 'scheduled' },
  );
  // Remove the obsolete 24h scheduler from the pre-tiering design, if present.
  await refreshQueue.removeJobScheduler('refresh-all-24h').catch(() => undefined);
  await refreshQueue.close();

  const boardQueue = new Queue<CrawlBoardJobData>(QueueNames.CRAWL_BOARD, {
    connection: createRedisConnection(),
  });
  await boardQueue.upsertJobScheduler(
    'board-remoteok-24h',
    { every: 24 * 60 * 60 * 1000 },
    {
      name: 'remoteok',
      data: { board: 'remoteok' },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    },
  );
  await boardQueue.close();

  const discoveryQueue = new Queue(QueueNames.DISCOVERY_FANOUT, {
    connection: createRedisConnection(),
  });
  await discoveryQueue.upsertJobScheduler(
    'discovery-fanout-10m',
    { every: 10 * 60 * 1000 },
    { name: 'scheduled' },
  );
  await discoveryQueue.close();

  console.log('[scheduler] due-companies: 15m; boards: 24h; discovery-fanout: 10m');
}
