import { Prisma } from '@prisma/client';

/**
 * Country → location-string patterns. `jobs.country` is null on ~90% of rows
 * (ATS payloads rarely carry it), so preference filtering must fall back to
 * matching the free-form location string. Strict by design: a job that names
 * neither the country nor one of its cities does NOT pass — "Remote (global)"
 * is excluded when a countries preference is set (2026-07-08, Suyash: India
 * only for now; US-remote notifications were noise).
 */
const COUNTRY_LOCATION_PATTERNS: Record<string, string> = {
  IN: 'india|bengaluru|bangalore|mumbai|pune|new delhi|delhi ncr|delhi|hyderabad|chennai|noida|gurgaon|gurugram|indore|kolkata|ahmedabad|jaipur|kochi|trivandrum|chandigarh',
};

function locationPatternFor(countries: string[]): string | null {
  const parts = countries
    .map((c) => COUNTRY_LOCATION_PATTERNS[c.toUpperCase()])
    .filter((p): p is string => !!p);
  return parts.length ? parts.join('|') : null;
}

/** SQL predicate for the preferred-countries gate (TRUE when no preference). */
export function countrySql(countries: string[]): Prisma.Sql {
  if (countries.length === 0) return Prisma.sql`TRUE`;
  const pattern = locationPatternFor(countries);
  return pattern
    ? Prisma.sql`(j.country = ANY(${countries}) OR j.location ~* ${pattern})`
    : Prisma.sql`j.country = ANY(${countries})`;
}

const INDIA_CITIES = [
  'Bengaluru', 'Bangalore', 'Mumbai', 'Pune', 'New Delhi', 'Delhi NCR',
  'Delhi', 'Hyderabad', 'Chennai', 'Noida', 'Gurgaon', 'Gurugram', 'Indore',
  'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi', 'Trivandrum', 'Chandigarh',
];

/** "📍 Bangalore · 🏠 Remote" — scannable tags instead of raw location text. */
export function locationTags(location: string | null, workMode: string | null): string {
  const parts: string[] = [];
  if (location) {
    const city = INDIA_CITIES.find((c) => location.toLowerCase().includes(c.toLowerCase()));
    if (city) parts.push(`📍 ${city}`);
    else if (/india/i.test(location)) parts.push('📍 India');
    else parts.push(`🌍 ${location}`);
  }
  const mode = workMode ?? (location && /remote/i.test(location) ? 'REMOTE' : null);
  if (mode === 'REMOTE') parts.push('🏠 Remote');
  else if (mode === 'HYBRID') parts.push('🏢 Hybrid');
  else if (mode === 'ONSITE') parts.push('🏢 Onsite');
  return parts.join(' · ');
}

/** JS-side twin of countrySql for the notification gate. */
export function jobMatchesCountries(
  countries: string[],
  job: { country: string | null; location: string | null },
): boolean {
  if (countries.length === 0) return true;
  if (job.country && countries.some((c) => c.toUpperCase() === job.country?.toUpperCase())) {
    return true;
  }
  const pattern = locationPatternFor(countries);
  return !!(pattern && job.location && new RegExp(pattern, 'i').test(job.location));
}
