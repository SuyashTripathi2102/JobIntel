import type { NormalizedJob } from '@careeros/shared';
import { htmlToText } from './html';
import { AtsAdapter, capDescription, fetchJson } from './types';

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; country?: string; remote?: boolean; hybrid?: boolean };
  company?: { identifier?: string };
}

interface SrPostingDetail {
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
  applyUrl?: string;
}

const DETAIL_FETCH_CAP = 100; // descriptions need one call per posting — stay polite
const DETAIL_DELAY_MS = 300;

export const smartrecruitersAdapter: AtsAdapter = {
  source: 'smartrecruiters',

  async fetchJobs(companyId: string): Promise<NormalizedJob[]> {
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings`;
    const list = await fetchJson<{ content: SrPosting[]; totalFound: number }>(
      `${base}?limit=100`,
    );

    const jobs: NormalizedJob[] = [];
    for (const [i, p] of (list.content ?? []).entries()) {
      let description = '';
      let applyUrl: string | undefined;
      if (i < DETAIL_FETCH_CAP) {
        try {
          const detail = await fetchJson<SrPostingDetail>(`${base}/${p.id}`);
          description = Object.values(detail.jobAd?.sections ?? {})
            .map((s) => `${s.title ?? ''}\n${htmlToText(s.text ?? '')}`)
            .join('\n\n')
            .trim();
          applyUrl = detail.applyUrl;
          await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
        } catch {
          // keep the listing; description arrives on a future crawl
        }
      }
      jobs.push({
        externalId: p.id,
        title: p.name,
        description: capDescription(description),
        url:
          applyUrl ??
          `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${p.id}`,
        location: p.location?.city ?? null,
        country: p.location?.country?.toUpperCase() ?? null,
        workMode: p.location?.remote
          ? ('REMOTE' as const)
          : p.location?.hybrid
            ? ('HYBRID' as const)
            : null,
        postedAt: p.releasedDate ?? null,
      });
    }
    return jobs;
  },
};
