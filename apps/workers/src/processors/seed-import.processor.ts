import { Worker, Job } from 'bullmq';
import type { CompanyCandidate } from '@careeros/shared';
import { QueueNames } from '../queues/names';
import { createRedisConnection } from '../queues/connection';
import { ApiClient } from '../api-client';

export interface SeedImportJobData {
  source: 'yc';
  /** Cap for a first run — discovery probing is polite, so ramp deliberately. */
  limit?: number;
}

/**
 * Directory seeds: one-shot imports of company candidates. The prober then
 * converts them to MONITORED. YC's public dataset (yc-oss.github.io) lists
 * every YC company with website, industry, team size, and an isHiring flag.
 */
export function startSeedImportWorker(api: ApiClient): Worker<SeedImportJobData> {
  return new Worker<SeedImportJobData>(
    QueueNames.SEED_IMPORT,
    async (job: Job<SeedImportJobData>) => {
      if (job.data.source !== 'yc') throw new Error(`Unknown seed source ${job.data.source}`);

      const res = await fetch('https://yc-oss.github.io/api/companies/all.json', {
        headers: { 'user-agent': 'CareerOS/0.1 (personal job-search agent)' },
      });
      if (!res.ok) throw new Error(`YC dataset fetch -> ${res.status}`);
      const all = (await res.json()) as YcCompany[];

      const hiring = all.filter((c) => c.isHiring && c.website && c.status !== 'Inactive');
      const limited = job.data.limit ? hiring.slice(0, job.data.limit) : hiring;

      const candidates: CompanyCandidate[] = limited.map((c) => ({
        name: c.name,
        website: safeUrl(c.website),
        industry: c.industry ?? null,
        country: c.regions?.[0] ?? null,
        city: c.all_locations?.split(',')[0]?.trim() || null,
        teamSize: c.team_size ?? null,
        description: c.one_liner ?? null,
      }));

      const result = await api.bulkDiscover('yc', candidates);
      console.log(
        `[seed-import] yc: ${all.length} total, ${hiring.length} hiring, sent ${candidates.length} -> ${result.created} new / ${result.merged} merged`,
      );
      return result;
    },
    { connection: createRedisConnection() },
  );
}

interface YcCompany {
  name: string;
  website?: string;
  one_liner?: string;
  team_size?: number;
  industry?: string;
  all_locations?: string;
  regions?: string[];
  isHiring?: boolean;
  status?: string;
}

function safeUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    new URL(u);
    return u;
  } catch {
    return null;
  }
}
