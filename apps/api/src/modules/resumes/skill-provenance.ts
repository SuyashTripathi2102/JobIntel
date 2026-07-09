/**
 * Where did each skill on the profile come from?
 *
 * CareerOS may match on a skill the user typed in by hand — they are the
 * authority on their own history. It may never *claim the submitted PDF
 * contains it*: resume tailoring, recruiter keyword search and interview prep
 * all depend on the document and the profile agreeing.
 *
 * The first implementation asked `rawText.includes(skill.toLowerCase())`, the
 * same substring bug that let "JavaScript" satisfy a search for "java". It was
 * wrong in both directions: "REST APIs" does not appear inside "RESTful APIs",
 * so a skill genuinely printed on the resume was stamped MANUALLY_ADDED; and
 * "Go" appears inside "Google", so an invented skill was stamped as evidence.
 */
import { AMBIGUOUS_ALIASES, TECH_ALIASES, canonicalTech } from '../matching/role-classification';

export type SkillSource = 'RESUME_EXTRACTED' | 'MANUALLY_ADDED';

export interface SkillOrigin {
  skill: string;
  source: SkillSource;
}

// What counts as "inside a word". Deliberately includes . + # - so that "node"
// does not match "node-cron", "c" does not match "c++" or "css", and "rest"
// does not match "restful".
const WORD = 'A-Za-z0-9+#._-';

const ALIASES_BY_LENGTH = Object.keys(TECH_ALIASES).sort((a, b) => b.length - a.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tokenRe = (token: string) => new RegExp(`(^|[^${WORD}])(${escape(token)})([^${WORD}]|$)`, 'gi');

/**
 * Every technology the resume actually names, as canonical tokens.
 *
 * Longest alias first, consuming each match. "React Native" is claimed by
 * `react native` before `react` can see it, exactly as the JD matcher does —
 * boundaries alone are not enough, because "React" IS a whole token inside
 * "React Native".
 *
 * Ambiguous aliases ("go", "c", "sql", "react") are ordinary English words or
 * fragments of longer names. Once the longer names are consumed, what remains
 * is only accepted when the document capitalises it — "Go, Rust" is the
 * language, "go live in six weeks" is a verb. A false positive here means
 * CareerOS lying about the document, which is the one thing it must not do.
 */
export function resumeCanonicalTokens(rawText: string): Set<string> {
  let text = rawText;
  const found = new Set<string>();

  for (const alias of ALIASES_BY_LENGTH) {
    const ambiguous = AMBIGUOUS_ALIASES.has(alias);
    let matched = false;

    text = text.replace(tokenRe(alias), (_full, before: string, hit: string, after: string) => {
      // An ambiguous alias must be written as a proper noun to count.
      if (ambiguous && hit === hit.toLowerCase()) return _full;
      matched = true;
      return `${before}${' '.repeat(hit.length)}${after}`;
    });

    if (matched) found.add(TECH_ALIASES[alias]);
  }

  return found;
}

/** Is this skill actually printed on the resume? */
export function isNamedInResume(skill: string, rawText: string): boolean {
  return namedIn(skill, resumeCanonicalTokens(rawText), rawText);
}

function namedIn(skill: string, canonicals: Set<string>, rawText: string): boolean {
  if (!skill.trim()) return false;

  const canonical = canonicalTech(skill);
  if (canonical) return canonicals.has(canonical);

  // Technologies we have no alias for — Razorpay, Joi, Cloudinary, Strapi.
  // Nothing collides with these, so a whole-token match is safe.
  return tokenRe(skill.trim()).test(rawText);
}

/** Label every confirmed skill with its origin. Order is preserved. */
export function classifySkillOrigins(skills: string[], rawText: string): SkillOrigin[] {
  const canonicals = resumeCanonicalTokens(rawText);
  return skills.map((skill) => ({
    skill,
    source: namedIn(skill, canonicals, rawText) ? 'RESUME_EXTRACTED' : 'MANUALLY_ADDED',
  }));
}

export const manuallyAdded = (origins: SkillOrigin[]): string[] =>
  origins.filter((o) => o.source === 'MANUALLY_ADDED').map((o) => o.skill);
