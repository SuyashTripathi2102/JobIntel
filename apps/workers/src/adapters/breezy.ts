import type { NormalizedJob } from '@careeros/shared';
import { htmlToText } from './html';
import { AtsAdapter, capDescription, fetchJson, workModeFromText } from './types';

interface BreezyPosition {
  id: string;
  friendly_id?: string;
  name: string;
  description?: string; // HTML
  url?: string;
  published_date?: string;
  location?: {
    name?: string;
    city?: string;
    country?: { name?: string; id?: string };
    is_remote?: boolean;
  };
}

export const breezyAdapter: AtsAdapter = {
  source: 'breezy',

  async fetchJobs(companySlug: string): Promise<NormalizedJob[]> {
    const positions = await fetchJson<BreezyPosition[]>(
      `https://${encodeURIComponent(companySlug)}.breezy.hr/json`,
    );

    return (positions ?? []).map((p) => ({
      externalId: p.id,
      title: p.name,
      description: capDescription(htmlToText(p.description ?? '')),
      url: p.url ?? `https://${companySlug}.breezy.hr/p/${p.friendly_id ?? p.id}`,
      location: p.location?.name ?? p.location?.city ?? null,
      country: p.location?.country?.id ?? null,
      workMode: p.location?.is_remote
        ? ('REMOTE' as const)
        : workModeFromText(p.location?.name),
      postedAt: p.published_date ?? null,
    }));
  },
};
