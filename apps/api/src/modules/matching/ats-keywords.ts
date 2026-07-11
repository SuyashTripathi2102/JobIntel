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

export type KeywordStatus = 'PRESENT' | 'VARIANT' | 'MISSING';

export interface KeywordItem {
  /** The JD's exact phrasing — the string an ATS is matching on. */
  keyword: string;
  status: KeywordStatus;
  /** For VARIANT: the equivalent term you actually wrote. */
  yourTerm?: string;
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
      return { keyword, status: 'VARIANT', yourTerm: userByCanonical.get(canon) };
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

  const addExact = [
    ...req.filter((i) => i.status !== 'PRESENT'),
    ...pref.filter((i) => i.status === 'VARIANT'),
  ].map((i) => i.keyword);

  const requiredMatchPct = req.length
    ? Math.round((req.filter((i) => i.status === 'PRESENT').length / req.length) * 100)
    : null;

  return { required: req, preferred: pref, addExact, requiredMatchPct };
}
