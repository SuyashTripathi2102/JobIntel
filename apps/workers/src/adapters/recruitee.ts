import type { NormalizedJob } from '@careeros/shared';
import { htmlToText } from './html';
import { AtsAdapter, capDescription, fetchJson, workModeFromText } from './types';

interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string; // HTML
  requirements?: string; // HTML
  careers_url?: string;
  location?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  created_at?: string; // "2026-07-03 15:57:43 UTC"
  status?: string;
}

export const recruiteeAdapter: AtsAdapter = {
  source: 'recruitee',

  async fetchJobs(companySlug: string): Promise<NormalizedJob[]> {
    const data = await fetchJson<{ offers: RecruiteeOffer[] }>(
      `https://${encodeURIComponent(companySlug)}.recruitee.com/api/offers/`,
    );

    return (data.offers ?? [])
      .filter((o) => o.status !== 'closed')
      .map((o) => ({
        externalId: String(o.id),
        title: o.title,
        description: capDescription(
          [htmlToText(o.description ?? ''), htmlToText(o.requirements ?? '')]
            .filter(Boolean)
            .join('\n\n'),
        ),
        url: o.careers_url ?? `https://${companySlug}.recruitee.com/o/${o.id}`,
        location: o.location ?? null,
        country: o.country ?? null,
        workMode: o.remote
          ? ('REMOTE' as const)
          : o.hybrid
            ? ('HYBRID' as const)
            : o.on_site
              ? ('ONSITE' as const)
              : workModeFromText(o.location),
        postedAt: o.created_at ? new Date(o.created_at.replace(' UTC', 'Z')).toISOString() : null,
      }));
  },
};
