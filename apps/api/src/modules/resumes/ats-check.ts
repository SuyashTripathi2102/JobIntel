/**
 * ATS readability check.
 *
 * Real applicant tracking systems read a PDF's text layer and nothing else.
 * They have no vision fallback, so a PDF whose fonts lack a ToUnicode CMap
 * renders perfectly to a human and extracts as unmapped code points to a
 * machine. This ran on Suyash's Canva export (2026-07-09): it looked correct
 * on screen and yielded 942 letters among 2,198 control characters — zero
 * skills, zero contact details, no headings.
 *
 * Runs on RAW extracted text, before control characters are stripped: the
 * strip is what hides the damage.
 */

const COMMON_WORDS = [
  'the', 'and', 'with', 'for', 'using', 'experience',
  'developer', 'engineer', 'built', 'management',
];

const STANDARD_HEADINGS = [
  'SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'ACHIEVEMENTS',
];

// Cc category minus the whitespace an extractor legitimately emits.
const STRAY_CONTROL = /(?![\n\r\t])\p{Cc}/gu;

export type AtsVerdict = 'SAFE' | 'RISKY' | 'UNREADABLE';

export interface AtsCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface AtsReport {
  score: number;
  verdict: AtsVerdict;
  letterRatio: number;
  checks: AtsCheck[];
  /** Set when the text layer is unusable and only vision could read the file. */
  warning?: string;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/**
 * Headings must be matched as whole lines. A substring search finds
 * "EXPERIENCE" inside the tagline "2 Years Experience" and then reports a
 * correctly ordered resume as scrambled.
 */
function findHeadings(text: string): { heading: string; line: number }[] {
  const found: { heading: string; line: number }[] = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const l = raw.trim().toUpperCase().replace(/[^A-Z& ]/g, '').trim();
    if (!l || l.length > 24) return;
    const hit = STANDARD_HEADINGS.find(
      (h) => l === h || l === `WORK ${h}` || l === `PROFESSIONAL ${h}` || l === `TECHNICAL ${h}`,
    );
    if (hit && !found.some((f) => f.heading === hit)) found.push({ heading: hit, line });
  });
  return found;
}

export function checkAts(rawText: string): AtsReport {
  const text = rawText ?? '';
  const lower = text.toLowerCase();

  const letters = count(text, /[A-Za-z]/g);
  const printable = count(text, /\S/g);
  const control = count(text, STRAY_CONTROL);
  const letterRatio = printable ? letters / printable : 0;

  const words = COMMON_WORDS.filter((w) => lower.includes(w));

  const headingHits = findHeadings(text);
  // Compare against the canonical order, ignoring headings the resume omits.
  const canonical = headingHits.map((h) => STANDARD_HEADINGS.indexOf(h.heading));
  const inOrder = canonical.every((v, i, a) => i === 0 || a[i - 1] < v);

  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
  const hasPhone = /\+?\d[\d\s-]{8,}/.test(text);
  const hasProfile = /linkedin|github/i.test(text);

  const checks: AtsCheck[] = [
    {
      id: 'extractable',
      label: 'Text is extractable',
      pass: printable >= 200,
      detail: `${printable} characters in the text layer`,
    },
    {
      id: 'letter-ratio',
      label: 'Characters map to real letters',
      pass: letterRatio >= 0.7,
      detail:
        letterRatio >= 0.7
          ? `${(letterRatio * 100).toFixed(0)}% letters`
          : `only ${(letterRatio * 100).toFixed(0)}% letters, ${control} control characters — fonts are missing a ToUnicode map`,
    },
    {
      id: 'real-words',
      label: 'Extracts as real words',
      pass: words.length >= 5,
      detail: `${words.length}/${COMMON_WORDS.length} common words found`,
    },
    {
      id: 'headings',
      label: 'Standard section headings',
      pass: headingHits.length >= 3,
      detail: headingHits.length
        ? headingHits.map((h) => h.heading).join(' > ')
        : 'no standard headings detected',
    },
    {
      id: 'reading-order',
      label: 'Correct reading order',
      // With fewer than two headings there is no order to verify — reporting a
      // pass there would tell an unreadable PDF that its layout is fine.
      pass: headingHits.length >= 2 && inOrder,
      detail:
        headingHits.length < 2
          ? 'not enough headings to judge order'
          : inOrder
            ? 'sections in document order'
            : 'sections extract out of order (multi-column layout?)',
    },
    {
      id: 'contact',
      label: 'Contact details detected',
      pass: hasEmail && (hasPhone || hasProfile),
      detail: [hasEmail && 'email', hasPhone && 'phone', hasProfile && 'profile']
        .filter(Boolean)
        .join(', ') || 'none found',
    },
  ];

  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);

  // A file can pass most checks and still be unreadable if the glyphs are
  // unmapped — letterRatio is the one that decides whether an ATS sees words.
  const unreadable = letterRatio < 0.5 || printable < 200;
  const verdict: AtsVerdict = unreadable ? 'UNREADABLE' : score < 100 ? 'RISKY' : 'SAFE';

  return {
    score,
    verdict,
    letterRatio: Number(letterRatio.toFixed(3)),
    checks,
    warning: unreadable
      ? 'An applicant tracking system will read almost nothing from this PDF. Re-export it by opening the document in Chrome and using Print → Save as PDF.'
      : undefined,
  };
}
