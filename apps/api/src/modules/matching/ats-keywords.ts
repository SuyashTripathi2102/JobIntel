/**
 * ATS keyword audit — the highest interview-probability-per-effort feature.
 *
 * Applicant tracking systems keyword-match your resume against the JD, and the
 * match is frequently LITERAL: a resume that says "RESTful APIs" can fail a
 * filter looking for "REST API" even though a human reads them as identical.
 * So this answers a different question than specializationBreakdown (which asks
 * "do you have the skill?"):
 *
 *   PRESENT  — the JD's exact phrase is already in your resume text.
 *   VARIANT  — you have the technology, but wrote it differently; add the JD's
 *              exact wording so a literal ATS filter still catches it.
 *   MISSING  — not on your resume at all; add it if you can defend it.
 *
 * Required-section keywords rank above nice-to-have. Everything here is
 * deterministic — no LLM, no invented percentages.
 */
import { canonicalTech } from './role-classification';
import { resumeCanonicalTokens } from '../resumes/skill-provenance';

const WORD = 'A-Za-z0-9+#._-';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-phrase, case-insensitive, respecting token boundaries. */
function literalInText(phrase: string, text: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return new RegExp(`(^|[^${WORD}])${escape(p)}([^${WORD}]|$)`, 'i').test(text);
}

export type KeywordStatus = 'PRESENT' | 'ACCEPTED_VARIANT' | 'ADD_EXACT' | 'MISSING';

export interface KeywordItem {
  /** The JD's exact phrasing — the string an ATS is matching on. */
  keyword: string;
  status: KeywordStatus;
  /** The equivalent term you actually wrote (for variants). */
  yourTerm?: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Do two terms differ only trivially — punctuation, case, a .js/JS suffix — so
 * an ATS treats them as the same token? "React" vs "React.js" and "Node.js" vs
 * "NodeJS" are trivial (one normalizes to a substring of the other). "REST API"
 * vs "RESTful APIs" is NOT — those are different words, and a literal filter
 * misses them, so the user should add the exact phrase.
 */
function trivialVariant(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface AtsKeywordAudit {
  required: KeywordItem[];
  preferred: KeywordItem[];
  /** Exact strings to add, required-first — the actionable output. */
  addExact: string[];
  /** How many required keywords an ATS would literally match right now. */
  requiredMatchPct: number | null;
}

const dedupe = (arr: string[]) =>
  [...new Map(arr.filter(Boolean).map((k) => [k.trim().toLowerCase(), k.trim()])).values()];

export function atsKeywordAudit(
  required: string[],
  preferred: string[],
  resumeText: string,
  userSkills: string[],
): AtsKeywordAudit {
  const resumeTokens = resumeCanonicalTokens(resumeText);
  // canonical token -> the exact term the user wrote, for the "you wrote X" hint.
  const userByCanonical = new Map<string, string>();
  for (const s of userSkills) {
    const c = canonicalTech(s);
    if (c && !userByCanonical.has(c)) userByCanonical.set(c, s);
  }

  const classify = (keyword: string): KeywordItem => {
    if (literalInText(keyword, resumeText)) return { keyword, status: 'PRESENT' };
    const canon = canonicalTech(keyword);
    if (canon && resumeTokens.has(canon)) {
      const yourTerm = userByCanonical.get(canon);
      // You have the tech. Trivial spelling difference → ATS accepts it, leave
      // it alone. Real rewording → add the JD's exact phrase.
      const accepted = yourTerm ? trivialVariant(keyword, yourTerm) : false;
      return { keyword, status: accepted ? 'ACCEPTED_VARIANT' : 'ADD_EXACT', yourTerm };
    }
    return { keyword, status: 'MISSING' };
  };

  const reqKeys = dedupe(required);
  const req = reqKeys.map(classify);
  // A preferred keyword already in the required list is not repeated.
  const reqLower = new Set(reqKeys.map((k) => k.toLowerCase()));
  const pref = dedupe(preferred)
    .filter((k) => !reqLower.has(k.toLowerCase()))
    .map(classify);

  // Only urge additions that genuinely matter: required rewordings and truly
  // missing required keywords, plus preferred rewordings. Never nag about a
  // spelling an ATS already accepts.
  const addExact = [
    ...req.filter((i) => i.status === 'ADD_EXACT' || i.status === 'MISSING'),
    ...pref.filter((i) => i.status === 'ADD_EXACT'),
  ].map((i) => i.keyword);

  // "Covered" = literal match OR an accepted spelling variant.
  const requiredMatchPct = req.length
    ? Math.round(
        (req.filter((i) => i.status === 'PRESENT' || i.status === 'ACCEPTED_VARIANT').length /
          req.length) *
          100,
      )
    : null;

  return { required: req, preferred: pref, addExact, requiredMatchPct };
}
