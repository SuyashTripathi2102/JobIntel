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

  bulkDiscover(
    source: string,
    candidates: CompanyCandidate[],
  ): Promise<{ created: number; merged: number }> {
    return this.request('POST', '/internal/discovery/bulk', { source, candidates });
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
