/**
 * Curated company tiers (v1). Big-tech names hire evergreen — roles stay open
 * for months while interviewing continuously, so staleness rules must not
 * treat them like a 20-person startup's 70-day-old zombie posting.
 *
 * This static list is the honest v1: it needs no data we don't have. The
 * learned version (per-company avg posting lifetime from firstSeenAt/
 * lastSeenAt/REMOVED history) activates in Phase F once weeks of crawl
 * history accumulate — this DB started observing 2026-07-07.
 */

export type CompanyTier = 'BIG_TECH' | 'UNKNOWN';

const BIG_TECH = new Set([
  'google', 'alphabet', 'microsoft', 'amazon', 'aws', 'meta', 'apple',
  'netflix', 'openai', 'anthropic', 'nvidia', 'adobe', 'salesforce', 'oracle',
  'ibm', 'intel', 'uber', 'airbnb', 'atlassian', 'stripe', 'cloudflare',
  'databricks', 'snowflake', 'palantir', 'linkedin', 'spotify', 'shopify',
  'coinbase', 'dropbox', 'github', 'gitlab', 'figma', 'notion', 'vercel',
  'datadog', 'mongodb', 'elastic', 'twilio', 'plaid', 'ramp', 'brex',
]);

export function companyTier(name: string): CompanyTier {
  const normalized = name.toLowerCase().replace(/[,.]|\s+(inc|llc|ltd|corp)$/g, '').trim();
  return BIG_TECH.has(normalized) ? 'BIG_TECH' : 'UNKNOWN';
}

export function isEvergreen(tier: CompanyTier): boolean {
  return tier === 'BIG_TECH';
}
