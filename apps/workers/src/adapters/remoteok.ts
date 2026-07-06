import type { BoardJob } from '@careeros/shared';
import { decodeEntities, htmlToText } from './html';
import { capDescription, fetchJson } from './types';

interface RemoteOkItem {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string;
  description?: string; // HTML
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
  date?: string;
  legal?: string; // first array element is a legal notice, not a job
}

/**
 * RemoteOK's public API (attribution required — we store and show the
 * original URL, which satisfies it). This is a *board* source: every item
 * names a company we may not know yet, and apply_url frequently points at
 * the company's own ATS — prime discovery-flywheel input.
 */
export async function fetchRemoteOkJobs(): Promise<BoardJob[]> {
  const items = await fetchJson<RemoteOkItem[]>('https://remoteok.com/api');

  return items
    .filter((i) => i.id && i.position && i.company)
    .map((i) => ({
      company: {
        // RemoteOK names arrive HTML-encoded ("RG&amp;T Solutions") — decode
        // or the discovery prober guesses tokens from garbage.
        name: decodeEntities(i.company!),
        atsHintUrl: safeUrl(i.apply_url) ?? null,
      },
      job: {
        externalId: `remoteok-${i.id}`,
        title: decodeEntities(i.position!),
        description: capDescription(htmlToText(i.description ?? '')),
        url: safeUrl(i.url) ?? `https://remoteok.com/remote-jobs/${i.slug ?? i.id}`,
        location: i.location || 'Remote',
        workMode: 'REMOTE' as const,
        salaryMin: i.salary_min || null,
        salaryMax: i.salary_max || null,
        currency: i.salary_min ? 'USD' : null,
        postedAt: i.date ? new Date(i.date).toISOString() : null,
      },
    }));
}

function safeUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    new URL(u);
    return u;
  } catch {
    return undefined;
  }
}
