import { z } from 'zod';

/** Mirrors the Prisma AtsProvider enum — identical string values by design. */
export const AtsProviderSchema = z.enum([
  'GREENHOUSE',
  'LEVER',
  'ASHBY',
  'WORKDAY',
  'SMARTRECRUITERS',
  'RECRUITEE',
  'TEAMTAILOR',
  'OTHER',
  'UNKNOWN',
]);
export type AtsProviderName = z.infer<typeof AtsProviderSchema>;

export interface AtsDetection {
  provider: AtsProviderName;
  identifier: string | null;
}

/**
 * Detects an ATS provider + board identifier from any URL pointing at a
 * hosted job board or a specific posting on one. This is what turns
 * "here's a job/career link" into "we can crawl this company forever" —
 * the discovery pipeline's key move. Used by both the API (company create,
 * board-flywheel ingest) and the workers (career-page prober).
 */
export function detectAts(url: string): AtsDetection {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { provider: 'UNKNOWN', identifier: null };
  }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    // boards.greenhouse.io/{token}[/jobs/{id}] — "embed" pages put it in ?for=
    const token = segments[0] === 'embed' ? u.searchParams.get('for') : segments[0];
    return { provider: 'GREENHOUSE', identifier: token ?? null };
  }
  if (host === 'jobs.lever.co') {
    return { provider: 'LEVER', identifier: segments[0] ?? null };
  }
  if (host === 'jobs.ashbyhq.com') {
    return { provider: 'ASHBY', identifier: segments[0] ?? null };
  }
  if (host.endsWith('.myworkdayjobs.com')) {
    // {tenant}.wd{N}.myworkdayjobs.com/{site} — needs both to build the CXS API URL
    const tenant = host.split('.')[0];
    const site = segments.find((s) => !['en-US', 'wday'].includes(s));
    return { provider: 'WORKDAY', identifier: site ? `${tenant}/${site}` : tenant };
  }
  if (host.endsWith('.recruitee.com')) {
    return { provider: 'RECRUITEE', identifier: host.split('.')[0] };
  }
  if (host.endsWith('.teamtailor.com')) {
    return { provider: 'TEAMTAILOR', identifier: host.split('.')[0] };
  }
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    return { provider: 'SMARTRECRUITERS', identifier: segments[0] ?? null };
  }
  return { provider: 'UNKNOWN', identifier: null };
}

/** ATS providers we have working crawl adapters for (workers/src/adapters). */
export const CRAWLABLE_PROVIDERS: AtsProviderName[] = ['GREENHOUSE', 'LEVER', 'ASHBY'];
