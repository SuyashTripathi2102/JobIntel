import { Worker, Job } from 'bullmq';
import { QueueNames } from '../queues/names';
import { createRedisConnection } from '../queues/connection';
import { ApiClient } from '../api-client';
import { AtsAdapter } from '../adapters/types';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { leverAdapter } from '../adapters/lever';
import { ashbyAdapter } from '../adapters/ashby';
import { workableAdapter } from '../adapters/workable';
import { smartrecruitersAdapter } from '../adapters/smartrecruiters';
import { recruiteeAdapter } from '../adapters/recruitee';
import { breezyAdapter } from '../adapters/breezy';

export interface CrawlCompanyJobData {
  companyId: string;
  companyName: string;
  atsProvider: string;
  atsIdentifier: string;
}

const ADAPTERS: Record<string, AtsAdapter> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
  WORKABLE: workableAdapter,
  SMARTRECRUITERS: smartrecruitersAdapter,
  RECRUITEE: recruiteeAdapter,
  BREEZY: breezyAdapter,
  // WORKDAY / custom sites → Python scraper via SCRAPE_HARD_TARGET (next)
};

export function startCrawlCompanyWorker(api: ApiClient): Worker<CrawlCompanyJobData> {
  return new Worker<CrawlCompanyJobData>(
    QueueNames.CRAWL_COMPANY,
    async (job: Job<CrawlCompanyJobData>) => {
      const { companyId, companyName, atsProvider, atsIdentifier } = job.data;
      const adapter = ADAPTERS[atsProvider];
      if (!adapter) throw new Error(`No adapter for ATS provider ${atsProvider}`);

      const jobs = await adapter.fetchJobs(atsIdentifier);
      const result = await api.syncCompanyJobs(companyId, adapter.source, jobs);
      console.log(
        `[crawl-company] ${companyName}: found=${result.found} new=${result.created} removed=${result.removed}`,
      );
      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 5, // parallel companies, but gentle on any single ATS host
    },
  );
}
