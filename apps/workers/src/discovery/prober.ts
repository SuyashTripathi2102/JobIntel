import type { AtsDetection, DiscoveryResult } from '@careeros/shared';
import { detectAts } from '@careeros/shared';

const UA = 'CareerOS/0.1 (personal job-search agent)';
const FETCH_TIMEOUT_MS = 12_000;

/** Common career-page paths, ordered by hit rate. Probed politely (~6 max). */
const CAREER_PATHS = ['/careers', '/jobs', '/careers/jobs', '/join', '/company/careers', '/about/careers'];

/** Anchor-href patterns that mark a link as careers-related. */
const CAREER_LINK_RE =
  /href=["']([^"']*(?:career|careers|jobs|join-us|joinus|work-with-us|hiring|greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|recruitee\.com|teamtailor\.com|smartrecruiters\.com)[^"']*)["']/gi;

export interface ProbeInput {
  name: string;
  website?: string | null;
  careerPageUrl?: string | null;
}

/**
 * The conversion engine: takes whatever we know about a company (sometimes
 * just a name) and works the lifecycle — verify website → scan homepage →
 * probe common paths → follow redirects → guess ATS tokens from the name.
 * Every request is labeled with our UA; total requests per company ≤ ~12.
 */
export async function probeCompany(input: ProbeInput): Promise<DiscoveryResult> {
  const log: string[] = [];
  let website = input.website ?? null;
  let websiteVerified = false;
  let careerPageUrl: string | null = null;
  let ats: AtsDetection = { provider: 'UNKNOWN', identifier: null };
  let metadata: { title?: string | null; description?: string | null } | null = null;

  // 0. If we already hold a career/board hint, resolve it first (follows
  //    redirects — this converts RemoteOK-style redirect links into real ATS).
  if (input.careerPageUrl) {
    const resolved = await resolveUrl(input.careerPageUrl, log);
    if (resolved) {
      const detected = detectAts(resolved);
      if (detected.identifier) {
        ats = detected;
        careerPageUrl = resolved;
        log.push(`ATS from hint redirect: ${detected.provider}/${detected.identifier}`);
      }
    }
  }

  // 1. Verify website + harvest homepage metadata + scan for career links.
  if (website) {
    const page = await fetchPage(website, log);
    if (page) {
      websiteVerified = true;
      website = page.finalUrl;
      metadata = extractMetadata(page.html);

      if (!ats.identifier) {
        const links = extractCareerLinks(page.html, page.finalUrl);
        for (const link of links.slice(0, 4)) {
          const resolved = await resolveUrl(link, log);
          if (!resolved) continue;
          const detected = detectAts(resolved);
          if (detected.identifier) {
            ats = detected;
            careerPageUrl = resolved;
            log.push(`ATS from homepage link: ${detected.provider}/${detected.identifier}`);
            break;
          }
          if (!careerPageUrl && /career|job|join|hiring/i.test(resolved)) {
            careerPageUrl = resolved;
          }
        }
      }

      // 2. No career link on the homepage? Probe conventional paths.
      if (!ats.identifier && !careerPageUrl) {
        for (const path of CAREER_PATHS.slice(0, 4)) {
          const candidate = new URL(path, page.finalUrl).toString();
          const resolved = await resolveUrl(candidate, log, /* headOnly */ true);
          if (resolved) {
            careerPageUrl = resolved;
            const detected = detectAts(resolved);
            if (detected.identifier) {
              ats = detected;
              log.push(`ATS from path probe: ${detected.provider}/${detected.identifier}`);
            }
            break;
          }
        }
      }
    }
  }

  // 3. Career page found but ATS still unknown? Scan that page's HTML too —
  //    boards are usually embedded or linked from it.
  if (!ats.identifier && careerPageUrl) {
    const page = await fetchPage(careerPageUrl, log);
    if (page) {
      const links = extractCareerLinks(page.html, page.finalUrl);
      for (const link of links.slice(0, 4)) {
        const detected = detectAts(link);
        if (detected.identifier) {
          ats = detected;
          log.push(`ATS from career page: ${detected.provider}/${detected.identifier}`);
          break;
        }
      }
    }
  }

  // 4. Last resort: guess board tokens from the company name and probe the
  //    ATS APIs directly. Verification is free — a wrong guess 404s.
  if (!ats.identifier) {
    ats = await guessAtsToken(input.name, log);
  }

  return {
    websiteVerified,
    website: website ?? undefined,
    careerPageUrl: careerPageUrl ?? undefined,
    atsProvider: ats.identifier ? ats.provider : undefined,
    atsIdentifier: ats.identifier ?? undefined,
    metadata,
    probeLog: log.slice(0, 20),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchPage(
  url: string,
  log: string[],
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.push(`GET ${url} -> ${res.status}`);
      return null;
    }
    const html = (await res.text()).slice(0, 500_000);
    return { html, finalUrl: res.url || url };
  } catch (err) {
    log.push(`GET ${url} failed: ${err instanceof Error ? err.name : err}`);
    return null;
  }
}

/** Follow redirects; return the final URL if it resolves to a 2xx/3xx page. */
async function resolveUrl(url: string, log: string[], headOnly = false): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: headOnly ? 'HEAD' : 'GET',
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Some servers reject HEAD — retry small GET once.
    if (headOnly && res.status === 405) return resolveUrl(url, log, false);
    if (!res.ok) return null;
    return res.url || url;
  } catch {
    return null;
  }
}

function extractCareerLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(CAREER_LINK_RE)) {
    try {
      out.add(new URL(m[1], baseUrl).toString());
    } catch {
      /* malformed href */
    }
  }
  return [...out];
}

function extractMetadata(html: string): { title?: string | null; description?: string | null } {
  const title = html.match(/<title[^>]*>([^<]{1,200})/i)?.[1]?.trim() ?? null;
  const description =
    html
      .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)?.[1]
      ?.trim() ??
    html
      .match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i)?.[1]
      ?.trim() ??
    null;
  return { title, description };
}

/** Slug variants of a company name → probe each ATS's public API directly. */
async function guessAtsToken(name: string, log: string[]): Promise<AtsDetection> {
  const base = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  const slugs = [...new Set([base.replace(/\s+/g, ''), base.replace(/\s+/g, '-')])].filter(
    (s) => s.length >= 2,
  );

  for (const slug of slugs) {
    const probes: { provider: AtsDetection['provider']; url: string }[] = [
      { provider: 'GREENHOUSE', url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs` },
      { provider: 'LEVER', url: `https://api.lever.co/v0/postings/${slug}?mode=json&limit=1` },
      { provider: 'ASHBY', url: `https://api.ashbyhq.com/posting-api/job-board/${slug}` },
    ];
    for (const probe of probes) {
      try {
        const res = await fetch(probe.url, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.ok) {
          // Confirm the body actually looks like a board, not an error page.
          const body = await res.text();
          if (body.includes('"jobs"') || body.trim().startsWith('[')) {
            log.push(`ATS from token guess: ${probe.provider}/${slug}`);
            return { provider: probe.provider, identifier: slug };
          }
        }
      } catch {
        /* timeout/network — try next */
      }
    }
  }
  return { provider: 'UNKNOWN', identifier: null };
}
