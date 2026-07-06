import type { NormalizedJob } from '@careeros/shared';
import { htmlToText } from './html';
import { AtsAdapter, capDescription, fetchJson, workModeFromText } from './types';

interface WorkableJob {
  shortcode: string;
  title: string;
  description?: string; // HTML (present with details=true)
  url?: string;
  application_url?: string;
  published_on?: string;
  location?: { city?: string; country?: string; telecommuting?: boolean };
  locations?: { city?: string; country?: string }[];
  remote?: boolean;
}

export const workableAdapter: AtsAdapter = {
  source: 'workable',

  async fetchJobs(account: string): Promise<NormalizedJob[]> {
    const data = await fetchJson<{ jobs: WorkableJob[] }>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
    );

    return (data.jobs ?? []).map((j) => {
      const loc = j.location ?? j.locations?.[0];
      return {
        externalId: j.shortcode,
        title: j.title,
        description: capDescription(htmlToText(j.description ?? '')),
        url: j.url ?? `https://apply.workable.com/${account}/j/${j.shortcode}/`,
        location: loc?.city ?? null,
        country: loc?.country ?? null,
        workMode:
          j.remote || j.location?.telecommuting ? ('REMOTE' as const) : workModeFromText(loc?.city),
        postedAt: j.published_on ? new Date(j.published_on).toISOString() : null,
      };
    });
  },
};
