import type { ScoreModule } from '../opportunity/opportunity.service';

/**
 * The decision layer (ROADMAP Phase D-1): turn scores into a verdict a human
 * can act on in under 10 seconds. Rule-based v1 — no LLM call, no invented
 * probabilities; every reason traces to a stored score. Honest bands until
 * the applications tracker provides real outcome data (Phase F).
 */

export interface DecisionInput {
  opportunityScore: number;
  /** LLM resume-match percentage (JobMatch.overallScore). */
  resumeMatch: number;
  missingSkills: string[];
  modules: ScoreModule[];
  /** Job title — used to catch different role families (PM/sales/design). */
  title?: string;
  /** Days since posted (or first seen). Staleness caps the verdict. */
  ageDays?: number;
  /** Big-tech/evergreen employers keep strategic roles open for months. */
  evergreen?: boolean;
  /** Company added ≥3 jobs in the last 14 days — observably still hiring. */
  activelyHiring?: boolean;
}

export interface Decision {
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  /** e.g. "🟢 82/100 · HIGH PRIORITY" */
  banner: string;
  /** e.g. "✅ APPLY" */
  action: string;
  reasons: string[];
}

const LEARNABLE_GAP = 3; // ≤ this many missing skills reads as "learnable"

export function decide(input: DecisionInput): Decision {
  const score = Math.round(input.opportunityScore);
  const mod = (name: string) => input.modules.find((m) => m.module === name);

  const experience = mod('experienceFit');
  const freshness = mod('freshness');
  const company = mod('companyQuality');

  const reasons: string[] = [];
  const blockers: string[] = [];

  if (experience && experience.score >= 70) reasons.push('experience level fits');
  if (experience && experience.score < 35) blockers.push('seniority mismatch');
  if (input.resumeMatch >= 70) reasons.push(`strong resume match (${Math.round(input.resumeMatch)}%)`);
  if (freshness && freshness.score >= 80) reasons.push('freshly posted — early applicant advantage');
  if (company && company.score >= 70) reasons.push('solid company signals');

  if (input.missingSkills.length === 0) {
    reasons.push('no skill gaps detected');
  } else if (input.missingSkills.length <= LEARNABLE_GAP) {
    reasons.push(`missing only ${input.missingSkills.join(', ')} — learnable`);
  } else {
    blockers.push(`${input.missingSkills.length} skill gaps (${input.missingSkills.slice(0, 4).join(', ')}…)`);
  }

  // Core-stack mismatch: below-half resume match AND a wall of missing skills
  // is a different profession, not a stretch (2026-07-08 review: a React
  // Native role at 45% match with 7 gaps must not cost the user ten seconds).
  const coreMismatch = input.resumeMatch < 50 && input.missingSkills.length >= 5;
  if (coreMismatch) {
    blockers.push(`core stack mismatch — ${Math.round(input.resumeMatch)}% match, different specialization`);
  }

  // Role-family mismatch: an engineer should never be pushed a PM / sales /
  // design / QA-manager role just because the company context overlaps
  // (2026-07-09: an Associate Product Manager scored 68 and was sent).
  const roleMismatch = isNonEngineeringRole(input.title);
  if (roleMismatch) {
    blockers.push('different role family — not a software engineering position');
  }

  // Staleness interprets the age instead of just displaying it (2026-07-08
  // feedback: a 70d-old posting must never read as high priority) — but a
  // recruiter reads age in CONTEXT: Google leaves strategic roles open for
  // months; a 20-person startup's 70d posting is a zombie.
  const age = input.ageDays ?? 0;
  const stillHiring = input.evergreen || input.activelyHiring;
  if (age > 60) {
    if (stillHiring) {
      reasons.push(
        `open ${Math.round(age)}d — long, but this company hires continuously; likely still active`,
      );
    } else {
      blockers.push(`posted ${Math.round(age)}d ago — likely stale; hiring probability is low`);
    }
  } else if (age > 30) {
    if (stillHiring) {
      reasons.push(`open ${Math.round(age)}d — company is actively hiring, role likely live`);
    } else {
      blockers.push(`posted ${Math.round(age)}d ago — role may be in late hiring stages`);
    }
  } else if (age > 14) {
    reasons.push(`posted ${Math.round(age)}d ago — not fresh, apply soon if interested`);
  }

  let verdict: Decision['verdict'];
  if (score >= 75 && blockers.length === 0) verdict = 'APPLY';
  else if (score >= 60) verdict = 'CONSIDER';
  else verdict = 'SKIP';
  // A strong score with a hard blocker is still worth a human look — downgrade,
  // never silently drop.
  if (verdict === 'APPLY' && blockers.length > 0) verdict = 'CONSIDER';
  if (age > 60 && !stillHiring) verdict = 'SKIP';
  if (coreMismatch) verdict = 'SKIP';
  if (roleMismatch) verdict = 'SKIP';

  // Emoji follows the VERDICT, not the score — a green badge over "CONSIDER"
  // was contradictory (2026-07-09). Green = apply, yellow = consider, red = skip.
  const tierEmoji = verdict === 'APPLY' ? '🟢' : verdict === 'CONSIDER' ? '🟡' : '🔴';
  const action =
    verdict === 'APPLY' ? '✅ APPLY' : verdict === 'CONSIDER' ? '🤔 CONSIDER' : '❌ SKIP';

  return {
    verdict,
    // Decision first, evidence second — the score justifies, it doesn't lead.
    banner: `${tierEmoji} ${score}/100`,
    action,
    reasons: [...reasons, ...blockers.map((b) => `⚠ ${b}`)],
  };
}

/** Title-based role-family guard. Conservative — only fires on clear non-eng
 *  role words, and never on titles that also name an engineering discipline. */
function isNonEngineeringRole(title?: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  const eng =
    /\b(engineer|developer|programmer|sde|architect|devops|full[\s-]?stack|backend|back[\s-]?end|frontend|front[\s-]?end|software|data scientist|ml|machine learning)\b/;
  if (eng.test(t)) return false;
  const nonEng =
    /\b(product manager|program manager|project manager|sales|business development|marketing|recruit|talent acquisition|hr\b|human resources|designer|ux researcher|accountant|finance|customer success|account executive|content writer|operations manager|admin\b)\b/;
  return nonEng.test(t);
}

/** 🔥 today · 🟡 this week · ⚪ older — humans parse symbols faster than dates. */
export function freshnessLine(postedAt: Date | null, firstSeenAt: Date): string {
  const since = postedAt ?? firstSeenAt;
  const days = Math.floor((Date.now() - since.getTime()) / 86_400_000);
  if (days <= 0) return '🔥 Posted today';
  if (days === 1) return '🔥 Posted yesterday';
  if (days <= 7) return `🟡 Posted ${days} days ago`;
  return `⚪ Posted ${days} days ago`;
}

/** Listed salary or an honest "Not listed" — never estimated (ROADMAP principle). */
export function salaryLine(
  min: number | null,
  max: number | null,
  currency: string | null,
): string {
  if (min == null && max == null) return '💰 Salary not listed';
  const cur = currency ?? '';
  const fmt = (n: number) => n.toLocaleString('en-IN');
  if (min != null && max != null) return `💰 ${cur} ${fmt(min)}–${fmt(max)}`.trim();
  return `💰 ${cur} ${fmt((min ?? max) as number)}${min != null ? '+' : ''}`.trim();
}
