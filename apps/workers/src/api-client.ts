import type {
  BoardJob,
  CompanyCandidate,
  DiscoveryResult,
  NormalizedJob,
} from '@careeros/shared';

/**
 * The workers' only write path — everything goes through the API's internal
 * endpoints (shared-secret header). Workers never touch Postgres directly.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.API_URL ?? 'http://localhost:3001/api';
    const token = process.env.INTERNAL_API_TOKEN;
    if (!token) throw new Error('INTERNAL_API_TOKEN is not set');
    this.token = token;
  }

  getCompaniesDue(): Promise<CompanyDue[]> {
    return this.request('GET', '/internal/companies/due');
  }

  triggerDailyBrief(): Promise<{ sent: number }> {
    return this.request('POST', '/internal/daily-brief');
  }

  triggerConsiderDigest(): Promise<{ sent: number }> {
    return this.request('POST', '/internal/daily-brief/consider-digest');
  }

  syncCompanyJobs(companyId: string, source: string, jobs: NormalizedJob[]): Promise<SyncResult> {
    return this.request('POST', `/internal/companies/${companyId}/jobs/sync`, { source, jobs });
  }

  ingestBoardJobs(source: string, entries: BoardJob[]): Promise<SyncResult> {
    return this.request('POST', '/internal/boards/ingest', { source, entries });
  }

  // ── Company Discovery Engine ──

  getDiscoveryDue(limit: number): Promise<DiscoveryDueCompany[]> {
    return this.request('GET', `/internal/discovery/due?limit=${limit}`);
  }

  applyDiscoveryResult(companyId: string, result: DiscoveryResult): Promise<{ stage: string }> {
    return this.request('POST', `/internal/discovery/${companyId}/result`, result);
  }

  async bulkDiscover(
    source: string,
    candidates: CompanyCandidate[],
  ): Promise<{ created: number; merged: number }> {
    // The endpoint validates <=5000 items per request. A 24-city Places sweep
    // sends ~6,000, so one POST 400s and the whole sweep inserts nothing
    // (2026-07-11). Chunk it — smaller batches also keep each request fast and
    // let a partial failure lose one chunk, not the run.
    const CHUNK = 500;
    let created = 0;
    let merged = 0;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const batch = candidates.slice(i, i + CHUNK);
      const res = await this.request<{ created: number; merged: number }>(
        'POST',
        '/internal/discovery/bulk',
        { source, candidates: batch },
      );
      created += res.created;
      merged += res.merged;
    }
    return { created, merged };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}

export interface DiscoveryDueCompany {
  id: string;
  name: string;
  website: string | null;
  careerPageUrl: string | null;
  discoveryStage: string;
}

export interface CompanyDue {
  id: string;
  name: string;
  atsProvider: 'GREENHOUSE' | 'LEVER' | 'ASHBY' | string;
  atsIdentifier: string;
}

export interface SyncResult {
  crawlRunId: string;
  found: number;
  created: number;
  updated: number;
  removed: number;
}
