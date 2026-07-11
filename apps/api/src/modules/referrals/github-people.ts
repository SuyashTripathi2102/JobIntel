/**
 * People discovery from PUBLIC GitHub only.
 *
 * GitHub's REST API serves this data publicly and permits this use; we never
 * touch a ToS-protected network (no LinkedIn, no scraping a portal, no private
 * data). For a company we look at two public signals:
 *   • the org's PUBLIC members  — people who themselves chose to show they work
 *     there (the strongest "this person can refer you" signal), and
 *   • the top contributors to that org's active repos.
 * Each candidate is then hydrated with their public profile. We keep an address
 * ONLY if the person published it on their own GitHub profile — nothing is
 * harvested, guessed, or verified against a third-party service.
 *
 * A GITHUB_TOKEN (read-only, public scope — a server secret, never committed)
 * lifts the anonymous 60/hr limit to 5000/hr. Without one we still work, just
 * with a hard call budget so one lookup can't exhaust the anonymous quota.
 */

const GH = 'https://api.github.com';

export interface GitHubPerson {
  login: string;
  name: string | null;
  url: string; // public profile (html_url)
  avatarUrl: string | null;
  bio: string | null;
  company: string | null; // GitHub "company" field, verbatim as the person wrote it
  location: string | null;
  email: string | null; // ONLY if the person published it on their profile
  blog: string | null;
  twitter: string | null;
  publicMember: boolean; // confirmed PUBLIC member of the company's GitHub org
  contributions: number; // to the org's repos (0 if member-only / unknown)
  viaRepos: string[]; // org repos this person contributed to
}

export interface DiscoverOpts {
  companyName: string;
  website?: string | null;
  githubOrg?: string | null;
  token?: string;
  /** Max profiles to hydrate. Small anonymous budget → keep this low. */
  maxPeople?: number;
}

/** Shared across a lookup so we can tell "no engineers" from "GitHub throttled us". */
interface GhState {
  rateLimited: boolean;
}

/** A hard cap on API calls so an anonymous lookup can't burn the 60/hr quota. */
class Budget {
  private used = 0;
  constructor(private readonly max: number) {}
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
  get empty(): boolean {
    return this.used >= this.max;
  }
}

function headers(token?: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'CareerOS-Referrals',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** GET returning parsed JSON, or null on any non-200. Flags rate-limiting so the
 *  caller never mistakes "GitHub throttled us" for "this company has no engineers". */
async function ghGet<T>(
  url: string,
  token: string | undefined,
  budget: Budget,
  state: GhState,
): Promise<T | null> {
  if (!budget.take()) return null;
  try {
    const res = await fetch(url, { headers: headers(token) });
    if (!res.ok) {
      if (
        (res.status === 403 || res.status === 429) &&
        res.headers.get('x-ratelimit-remaining') === '0'
      ) {
        state.rateLimited = true;
      }
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Plausible GitHub org slugs for a company name. "Postman Inc." → ["postman"],
 * "Razorpay Software Pvt Ltd" → ["razorpay"]. Strips legal/industry suffixes so
 * the direct /orgs/{slug} lookup (cheap) usually hits before we fall back to
 * the rate-limited search endpoint.
 */
export function orgSlugCandidates(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(
      /\b(inc|llc|ltd|pvt|private|limited|technologies|technology|labs|lab|software|solutions|systems|global|india|corp|corporation|company|co|the)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const words = base.split(' ').filter(Boolean);
  if (!words.length) return [];
  const joined = words.join('');
  // Suffix variants catch the common "<name>labs / <name>hq" org convention
  // (e.g. Postman → postmanlabs) without depending on the rate-limited search API.
  return [
    ...new Set([joined, words.join('-'), words[0], `${joined}labs`, `${joined}hq`]),
  ].filter((s) => s.length >= 2);
}

/**
 * Does a contributor's self-reported GitHub "company" field name this employer?
 * Public org members always pass regardless; this is the filter that keeps a
 * random open-source contributor OUT unless they actually say they work there.
 */
export function companyFieldMatches(
  field: string | null,
  companyName: string,
  org: string,
): boolean {
  if (!field) return false;
  const f = field.toLowerCase().replace(/[@.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = [companyName.toLowerCase().split(' ')[0], org.toLowerCase()].filter(
    (t) => t.length >= 2,
  );
  return tokens.some((t) => f.includes(t));
}

const normBlog = (blog: string | null | undefined): string | null => {
  if (!blog) return null;
  const b = blog.trim();
  if (!b) return null;
  return /^https?:\/\//i.test(b) ? b : `https://${b}`;
};

const isBot = (login: string): boolean => /\[bot\]$/i.test(login) || login.endsWith('-bot');

interface RawUser {
  login: string;
  name?: string | null;
  html_url: string;
  avatar_url?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  blog?: string | null;
  twitter_username?: string | null;
}

async function resolveOrg(
  opts: DiscoverOpts,
  token: string | undefined,
  budget: Budget,
  state: GhState,
): Promise<string | null> {
  const tryOrg = async (slug: string): Promise<string | null> => {
    if (!slug || budget.empty) return null;
    const o = await ghGet<{ login: string }>(
      `${GH}/orgs/${encodeURIComponent(slug)}`,
      token,
      budget,
      state,
    );
    return o?.login ?? null;
  };

  // 1) A github org we already recorded on the company wins outright.
  if (opts.githubOrg) {
    const slug = opts.githubOrg.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
    const hit = await tryOrg(slug);
    if (hit) return hit;
  }
  // 2) Cheap direct lookups on derived slugs.
  for (const c of orgSlugCandidates(opts.companyName)) {
    const hit = await tryOrg(c);
    if (hit) return hit;
  }
  // 3) Search (rate-limited) as a last resort.
  if (!budget.empty) {
    const res = await ghGet<{ items?: { login: string; type: string }[] }>(
      `${GH}/search/users?q=${encodeURIComponent(opts.companyName)}+type:org&per_page=3`,
      token,
      budget,
      state,
    );
    const item = res?.items?.find((i) => i.type === 'Organization');
    if (item) return item.login;
  }
  return null;
}

async function listPublicMembers(
  org: string,
  token: string | undefined,
  budget: Budget,
  state: GhState,
): Promise<Set<string>> {
  const members = await ghGet<{ login: string }[]>(
    `${GH}/orgs/${org}/public_members?per_page=50`,
    token,
    budget,
    state,
  );
  return new Set((members ?? []).map((m) => m.login).filter((l) => !isBot(l)));
}

async function topContributors(
  org: string,
  token: string | undefined,
  budget: Budget,
  state: GhState,
): Promise<Map<string, { contributions: number; repos: string[] }>> {
  const map = new Map<string, { contributions: number; repos: string[] }>();
  const repos = await ghGet<{ name: string; fork: boolean }[]>(
    `${GH}/orgs/${org}/repos?sort=pushed&per_page=8&type=sources`,
    token,
    budget,
    state,
  );
  const active = (repos ?? []).filter((r) => !r.fork).slice(0, 4);
  for (const repo of active) {
    if (budget.empty) break;
    const contributors = await ghGet<{ login: string; contributions: number }[]>(
      `${GH}/repos/${org}/${repo.name}/contributors?per_page=12`,
      token,
      budget,
      state,
    );
    for (const c of contributors ?? []) {
      if (isBot(c.login)) continue;
      const cur = map.get(c.login) ?? { contributions: 0, repos: [] };
      cur.contributions += c.contributions ?? 0;
      if (!cur.repos.includes(repo.name)) cur.repos.push(repo.name);
      map.set(c.login, cur);
    }
  }
  return map;
}

/** Members first, then contributors by contribution count; deduped and capped. */
function orderCandidates(
  members: Set<string>,
  contributors: Map<string, { contributions: number; repos: string[] }>,
  cap: number,
): string[] {
  const ranked = [...contributors.entries()]
    .sort((a, b) => b[1].contributions - a[1].contributions)
    .map(([login]) => login);
  return [...new Set([...members, ...ranked])].slice(0, cap);
}

/**
 * Find people at a company via public GitHub. Returns the resolved org (null if
 * the company has no discoverable GitHub presence) and the hydrated people who
 * either publicly belong to the org or self-report working there.
 */
export async function discoverGithubPeople(
  opts: DiscoverOpts,
): Promise<{ org: string | null; people: GitHubPerson[]; rateLimited: boolean }> {
  const token = opts.token;
  const budget = new Budget(token ? 120 : 20);
  const state: GhState = { rateLimited: false };
  const org = await resolveOrg(opts, token, budget, state);
  if (!org) return { org: null, people: [], rateLimited: state.rateLimited };

  const members = await listPublicMembers(org, token, budget, state);
  const contributors = await topContributors(org, token, budget, state);
  const cap = opts.maxPeople ?? (token ? 40 : 12);
  const candidates = orderCandidates(members, contributors, cap);

  const people: GitHubPerson[] = [];
  for (const login of candidates) {
    if (budget.empty) break;
    const u = await ghGet<RawUser>(`${GH}/users/${login}`, token, budget, state);
    if (!u) continue;
    const publicMember = members.has(login);
    // Keep only confirmed employees: public org members, or contributors who
    // themselves say they work here. Everyone else is an outside OSS contributor.
    if (!publicMember && !companyFieldMatches(u.company ?? null, opts.companyName, org)) continue;
    const contrib = contributors.get(login);
    people.push({
      login,
      name: u.name ?? null,
      url: u.html_url,
      avatarUrl: u.avatar_url ?? null,
      bio: u.bio ?? null,
      company: u.company ?? null,
      location: u.location ?? null,
      email: u.email ?? null,
      blog: normBlog(u.blog),
      twitter: u.twitter_username ?? null,
      publicMember,
      contributions: contrib?.contributions ?? 0,
      viaRepos: contrib?.repos ?? [],
    });
  }
  return { org, people, rateLimited: state.rateLimited };
}
