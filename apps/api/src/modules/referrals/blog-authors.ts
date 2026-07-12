/**
 * Engineering-blog authors — the honest "beyond GitHub" referral source.
 *
 * People who write for a company's engineering blog are public, usually senior
 * engineers you can genuinely engage (read a post, comment thoughtfully, then
 * reach out warm). We read ONLY the company's own blog and pull names from
 * structured data and bylines — no guessing, no third-party scraping. If we
 * can't confidently extract a real person's name, we emit nothing.
 */

export interface BlogAuthors {
  blogUrl: string;
  authors: string[];
}

const NOT_A_PERSON =
  /^(the |our )?(team|staff|editor(ial)?|admin|guest|contributor|engineering|marketing|content|blog|company|community|newsroom|press|careers?|hr|people|talent)\b/i;
// A word that outs a "name" as a team/role label — in ANY position ("Postman Team").
const LABEL_WORD =
  /^(team|staff|editor(?:ial)?|admin|guest|bot|official|hq|inc|llc|blog|news|press|careers?|hr|marketing|engineering|content|community|labs)$/i;

/** A plausible human name: 2–3 capitalised words, not a role/team label. */
export function isPersonName(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 4 || s.length > 40) return false;
  if (NOT_A_PERSON.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (words.some((w) => LABEL_WORD.test(w))) return false;
  // Each word starts uppercase and is alphabetic (allow O'Brien, hyphenates, dots).
  return words.every((w) => /^[A-Z][A-Za-z'.\-]+$/.test(w));
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

async function fetchHtml(url: string, timeoutMs = 6000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'CareerOS-Referrals', accept: 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Author names from JSON-LD Article/BlogPosting blocks — the highest-signal source. */
function fromJsonLd(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const author = (node as { author?: unknown })?.author;
      const authors = Array.isArray(author) ? author : author ? [author] : [];
      for (const a of authors) {
        const name = typeof a === 'string' ? a : (a as { name?: string })?.name;
        if (name) out.push(name);
      }
    }
  }
  return out;
}

/** Author names from meta tags and common byline markup. */
function fromMarkup(html: string): string[] {
  const out: string[] = [];
  const push = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.push(m[1]);
  };
  push(/<meta[^>]+(?:name|property)="(?:author|article:author)"[^>]+content="([^"]+)"/gi);
  push(/rel="author"[^>]*>([^<]{3,40})</gi);
  push(/class="[^"]*(?:author|byline)[^"]*"[^>]*>\s*(?:by\s+)?([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+){1,2})\s*</gi);
  return out;
}

/**
 * Discover engineering-blog authors. Best-effort and bounded: the company's own
 * blog (its recorded URL, or a couple of conventional paths), a few seconds.
 */
export async function discoverBlogAuthors(opts: {
  engineeringBlogUrl?: string | null;
  website?: string | null;
}): Promise<BlogAuthors | null> {
  const host = hostOf(opts.website);
  const candidates = [
    opts.engineeringBlogUrl,
    host ? `https://${host}/blog` : null,
    host ? `https://blog.${host}` : null,
    host ? `https://${host}/engineering` : null,
  ].filter((u): u is string => !!u);

  for (const url of candidates.slice(0, 3)) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const names = [...fromJsonLd(html), ...fromMarkup(html)]
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(isPersonName);
    const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()].slice(0, 8);
    if (unique.length > 0) return { blogUrl: url, authors: unique };
  }
  return null;
}
