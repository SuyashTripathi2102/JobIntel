import { Worker, Job, Queue } from 'bullmq';
import { QueueNames } from '../queues/names';
import { createRedisConnection } from '../queues/connection';
import { ApiClient } from '../api-client';
import { probeCompany } from '../discovery/prober';

export interface DiscoverCompanyJobData {
  companyId: string;
  name: string;
  website?: string | null;
  careerPageUrl?: string | null;
}

export function startDiscoverCompanyWorker(api: ApiClient): Worker<DiscoverCompanyJobData> {
  return new Worker<DiscoverCompanyJobData>(
    QueueNames.DISCOVER_COMPANY,
    async (job: Job<DiscoverCompanyJobData>) => {
      const result = await probeCompany(job.data);
      const applied = await api.applyDiscoveryResult(job.data.companyId, result);
      console.log(
        `[discover] ${job.data.name}: -> ${applied.stage}` +
          (result.atsIdentifier ? ` (${result.atsProvider}/${result.atsIdentifier})` : ''),
      );
      return applied;
    },
    {
      connection: createRedisConnection(),
      concurrency: 3, // politeness: ≤3 companies probed in parallel
    },
  );
}

/** Fan out due discovery work — called by its own repeatable scheduler. */
export function startDiscoveryFanoutWorker(api: ApiClient): Worker {
  const discoverQueue = new Queue<DiscoverCompanyJobData>(QueueNames.DISCOVER_COMPANY, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  return new Worker(
    QueueNames.DISCOVERY_FANOUT,
    async () => {
      const due = await api.getDiscoveryDue(25);
      if (due.length === 0) return { enqueued: 0 };
      await discoverQueue.addBulk(
        due.map((c) => ({
          name: c.name,
          data: {
            companyId: c.id,
            name: c.name,
            website: c.website,
            careerPageUrl: c.careerPageUrl,
          },
          opts: { jobId: `discover-${c.id}` },
        })),
      );
      console.log(`[discovery-fanout] enqueued ${due.length} companies to probe`);
      return { enqueued: due.length };
    },
    { connection: createRedisConnection() },
  );
}
