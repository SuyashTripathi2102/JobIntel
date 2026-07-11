/**
 * Hacker News "Ask HN: Who is hiring?" — the highest-signal free source of
 * software jobs there is. A monthly thread whose top-level comments are each a
 * job posting from a company actively hiring engineers. Official public API
 * (Algolia), zero ToS risk.
 *
 * Parsing is conservative on purpose: these comments are free text. We only
 * emit a job when we can confidently pull a company and a role, and we keep
 * only remote or India-relevant postings so the pipeline isn't flooded with
 * US-onsite roles the user can't act on. The classifier + matcher do the rest.
 */
import type { BoardJob } from '@careeros/shared';
import { capDescription, fetchJson } from './types';

interface AlgoliaStory {
  objectID: string;
  title: string;
  created_at: string;
}
interface AlgoliaSearch {
  hits: AlgoliaStory[];
}
interface AlgoliaItem {
  id: number;
  title?: string;
  children?: AlgoliaComment[];
}
interface AlgoliaComment {
  id: number;
  author?: string;
  text?: string | null;
}

/** The most recent "Who is hiring?" thread, posted monthly by whoishiring. */
async function latestThreadId(): Promise<string | null> {
  const res = await fetchJson<AlgoliaSearch>(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=5',
  );
  const hit = res.hits.find((h) => /who is hiring/i.test(h.title));
  return hit?.objectID ?? null;
}

const stripHtml = (html: string) =>
  html
    .replace(/<a[^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi, ' $1 ') // keep the URL text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const firstUrl = (text: string): string | null =>
  text.match(/https?:\/\/[^\s)|]+/i)?.[0]?.replace(/[.,]$/, '') ?? null;

const ROLE = /engineer|developer|\bsde\b|programmer|full.?stack|back.?end|front.?end|software|architect/i;
const INDIA = /india|bangalore|bengaluru|mumbai|pune|hyderabad|delhi|gurgaon|gurugram|noida|chennai/i;
const WORLDWIDE = /remote\s*\(?\s*(worldwide|anywhere|global)|worldwide|(fully|100%)\s*remote|remote,?\s*(worldwide|anywhere)/i;
// Restricted to a region an India-based applicant can't take — the big HN
// majority. If a posting says US/EU/UK-only, skip it however good it looks.
const REGION_LOCKED =
  /\bus[\s-]?only|usa[\s-]?only|u\.s\.?[\s-]?only|\bus[- ]based|must be (located |based )?in the (us|usa|united states|uk|eu)|us citizen|us work authoriz|authoriz\w* to work in the (us|uk|eu)|remote\s*\(?\s*(us|usa|united states|eu|europe|uk|canada|north america|americas|us\/canada|us & canada|us, canada)|(us|eu|uk|canada|europe|north america)[\s-]?(only|based|remote)|est timezone|pst timezone|within the (us|uk|eu)/i;

/** Actionable for an India-based applicant: a dev role, worldwide-remote or India, not region-locked. */
function isRelevant(text: string): boolean {
  if (!ROLE.test(text)) return false;
  if (REGION_LOCKED.test(text)) return false;
  return WORLDWIDE.test(text) || INDIA.test(text);
}

/** Position 0 of the header should be a company — not a city, salary, or URL. */
function looksLikeCompany(s: string): boolean {
  if (s.length < 2 || s.length > 60) return false;
  if (/^https?:/i.test(s)) return false; // URL
  if (/\$|\d{2,3}\s?k\b|\d{2,3}[-–]\d{2,3}\s?k|salary|equity|benefits/i.test(s)) return false; // salary/comp
  if (/^(remote|onsite|hybrid|full.?time|part.?time|contract|intern)/i.test(s)) return false;
  if (/^[A-Za-z .]+,\s*[A-Z]{2}$/.test(s)) return false; // "Blaine, WA" city, state
  if (/remote|worldwide|anywhere/i.test(s) && s.length < 30) return false;
  return true;
}

/**
 * Parse one top-level comment into a BoardJob. HN convention: the first line is
 * "Company | Role | Location | REMOTE | ...". Strict on purpose — returns null
 * unless the first segment is plausibly a company AND a segment names a real
 * role AND the posting is actionable from India. A skipped real job beats a
 * fabricated company or a US-only role in the user's feed.
 */
function parseComment(c: AlgoliaComment): BoardJob | null {
  if (!c.text) return null;
  const text = stripHtml(c.text);
  if (text.length < 60 || !isRelevant(text)) return null;

  const header = stripHtml(c.text.split(/<p>|\n/)[0] ?? text);
  const parts = header.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Drop a trailing unclosed "(...": "Enveritas (YC S18, non-profit" -> "Enveritas".
  const clean = (s: string) => s.replace(/\s*\([^)]*$/, '').replace(/^\W+|\W+$/g, '').trim();

  const company = clean(parts[0]).slice(0, 60);
  if (!looksLikeCompany(company)) return null;

  // The role MUST be an explicit segment with a role keyword — no guessing.
  const roleSeg = parts.slice(1).find((p) => ROLE.test(p));
  if (!roleSeg) return null;
  const title = clean(roleSeg).slice(0, 160);

  const url = firstUrl(text);
  const applyUrl = url && !url.includes('news.ycombinator.com') ? url : null;
  const location = parts.find((p) => /remote|worldwide|anywhere/i.test(p) || INDIA.test(p)) ?? null;

  return {
    company: { name: company, atsHintUrl: applyUrl },
    job: {
      externalId: `hn-${c.id}`,
      title,
      description: capDescription(text),
      url: applyUrl ?? `https://news.ycombinator.com/item?id=${c.id}`,
      location,
      country: INDIA.test(text) ? 'IN' : null,
      workMode: /remote|worldwide|anywhere/i.test(text) ? 'REMOTE' : null,
    },
  };
}

export async function fetchHnWhoIsHiring(): Promise<BoardJob[]> {
  const threadId = await latestThreadId();
  if (!threadId) {
    console.log('[hn-whoishiring] no thread found');
    return [];
  }
  const thread = await fetchJson<AlgoliaItem>(`https://hn.algolia.com/api/v1/items/${threadId}`);
  const comments = thread.children ?? [];
  const jobs: BoardJob[] = [];
  for (const c of comments) {
    try {
      const job = parseComment(c);
      if (job) jobs.push(job);
    } catch {
      /* one malformed comment never stops the batch */
    }
  }
  console.log(`[hn-whoishiring] thread ${threadId}: ${comments.length} comments -> ${jobs.length} relevant jobs`);
  return jobs;
}
