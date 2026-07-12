/**
 * Company contact channels — the honest fallback when no inside person is found.
 *
 * We read ONLY the company's own public pages (careers / contact / homepage) and
 * keep ONLY addresses the company itself published there. Nothing is guessed —
 * no "firstname@company.com" pattern spam, no third-party finder. A published
 * careers@ mailbox exists to be written to; a guessed personal address does not.
 * This is the same class of source we already crawl for jobs (the company's own
 * site), never a ToS-protected portal.
 */

export type ChannelKind = 'RECRUITING' | 'GENERAL' | 'OTHER';

export interface CompanyEmail {
  address: string;
  kind: ChannelKind;
}

export interface CompanyChannels {
  emails: CompanyEmail[];
  careerPageUrl: string | null;
  contactPageUrl: string | null;
  // Engineering-blog authors (a "beyond GitHub" people source). Optional so
  // older callers/records stay valid.
  blogUrl?: string | null;
  blogAuthors?: string[];
  // ISO timestamp of the last probe — company-level channels are cached ~14d
  // independently of the per-user people cache.
  probedAt?: string;
}

const RECRUITING_LOCAL =
  /^(careers?|jobs?|hiring|recruit(?:ing|ment)?|talent|hr|people|joinus|join|work|apply|hello-careers)$/i;
const GENERAL_LOCAL = /^(info|hello|contact|hi|team|hey|reach|enquir(?:y|ies)|hola)$/i;

// Local parts / domains that are never a real human contact channel.
const JUNK_LOCAL = /^(example|user|name|email|your|yourname|firstname|lastname|no-?reply|noreply|donotreply|test|sentry|wixpress|abuse|postmaster|mailer-daemon)$/i;
const JUNK_DOMAIN = /(example\.(com|org)|sentry\.io|wixpress\.com|domain\.com|email\.com|yourcompany\.com|sentry-next\.wixpress\.com)$/i;

export function classifyEmail(local: string): ChannelKind {
  if (RECRUITING_LOCAL.test(local)) return 'RECRUITING';
  if (GENERAL_LOCAL.test(local)) return 'GENERAL';
  return 'OTHER';
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Emails literally present in the page. When we know the company's domain we
 * keep only same-domain addresses (its own mailboxes), which also filters out
 * embedded analytics/widget addresses from third parties.
 */
export function extractEmails(html: string, siteHost: string | null): CompanyEmail[] {
  const found = new Map<string, CompanyEmail>();
  for (const raw of html.match(EMAIL_RE) ?? []) {
    const address = raw.toLowerCase().replace(/[.,;:]+$/, '');
    const at = address.lastIndexOf('@');
    if (at < 1) continue;
    const local = address.slice(0, at);
    const domain = address.slice(at + 1);
    if (JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain)) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(domain)) continue; // asset filename caught as email
    if (siteHost && domain !== siteHost && !domain.endsWith(`.${siteHost}`)) continue;
    if (!found.has(address)) found.set(address, { address, kind: classifyEmail(local) });
  }
  const order: Record<ChannelKind, number> = { RECRUITING: 0, GENERAL: 1, OTHER: 2 };
  return [...found.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 6);
}

/** Fetch a page's HTML with a hard timeout and size cap; null on any failure. */
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
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** First same-site link whose text/href mentions "contact", absolutised. */
function findContactLink(html: string, base: string): string | null {
  const re = /<a[^>]+href="([^"]+)"[^>]*>([^<]*contact[^<]*)<\/a>/gi;
  const m = re.exec(html) ?? /href="([^"]*contact[^"]*)"/i.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1], base).toString();
  } catch {
    return null;
  }
}

/**
 * Discover a company's public contact channels. Best-effort and bounded: a few
 * of the company's own pages, a few seconds, then whatever we honestly found.
 */
export async function discoverCompanyChannels(opts: {
  website?: string | null;
  careerPageUrl?: string | null;
}): Promise<CompanyChannels> {
  const siteHost = hostOf(opts.website) ?? hostOf(opts.careerPageUrl);
  const base = opts.website
    ? /^https?:\/\//i.test(opts.website)
      ? opts.website
      : `https://${opts.website}`
    : null;

  const targets = [opts.careerPageUrl, base, base ? new URL('/contact', base).toString() : null]
    .filter((u): u is string => !!u)
    .slice(0, 3);

  const emails = new Map<string, CompanyEmail>();
  let contactPageUrl: string | null = null;

  for (const url of targets) {
    const html = await fetchHtml(url);
    if (!html) continue;
    for (const e of extractEmails(html, siteHost)) if (!emails.has(e.address)) emails.set(e.address, e);
    if (!contactPageUrl && base) contactPageUrl = findContactLink(html, base);
  }

  const order: Record<ChannelKind, number> = { RECRUITING: 0, GENERAL: 1, OTHER: 2 };
  return {
    emails: [...emails.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 6),
    careerPageUrl: opts.careerPageUrl ?? null,
    contactPageUrl,
  };
}
