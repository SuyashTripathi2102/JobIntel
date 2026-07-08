import type { NormalizedJob } from '@careeros/shared';
import { htmlToText } from './html';
import { AtsAdapter, capDescription, fetchJson, workModeFromText } from './types';

/**
 * Keka (Indian ATS, Hyderabad) — public careers API discovered 2026-07-09.
 * The identifier is the tenant subdomain; the org document id lives only in
 * page content, so we resolve it per crawl:
 *   GET  https://{tenant}.keka.com/careers/            → contains /ats/documents/{uuid}/
 *   GET  .../careers/api/embedjobs/default/active/{uuid} → job list JSON
 * Job page: https://{tenant}.keka.com/careers/jobdetails/{id}
 */

interface KekaJob {
  id: number;
  title: string;
  description?: string; // HTML
  jobLocations?: { name?: string; city?: string; countryCode?: string }[];
  publishedOn?: string;
  skillNames?: string[];
}

const ORG_ID_RE = /\/ats\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export const kekaAdapter: AtsAdapter = {
  source: 'keka',

  async fetchJobs(tenant: string): Promise<NormalizedJob[]> {
    const base = `https://${encodeURIComponent(tenant)}.keka.com`;

    const page = await fetch(`${base}/careers/`, {
      headers: { 'user-agent': 'CareerOS/0.1 (personal job-search agent)' },
    });
    if (!page.ok) throw new Error(`GET ${base}/careers/ -> ${page.status}`);
    const html = await page.text();
    const orgId = ORG_ID_RE.exec(html)?.[1];
    if (!orgId) throw new Error(`Keka org id not found on ${tenant} careers page`);

    const jobs = await fetchJson<KekaJob[]>(
      `${base}/careers/api/embedjobs/default/active/${orgId}`,
    );

    return (jobs ?? []).map((j) => {
      const loc = j.jobLocations?.[0];
      const location = loc?.name ?? loc?.city ?? null;
      return {
        externalId: String(j.id),
        title: j.title,
        description: capDescription(htmlToText(j.description ?? '')),
        url: `${base}/careers/jobdetails/${j.id}`,
        location,
        country: loc?.countryCode ?? null,
        workMode: workModeFromText(`${j.title} ${location ?? ''}`),
        postedAt: j.publishedOn ? new Date(j.publishedOn).toISOString() : null,
      };
    });
  },
};
