/**
 * Outreach strategy — turns a ranked list of people into a PLAN, not a pile.
 *
 * Three things the raw shortlist doesn't give you:
 *   • WHY each person (explicit bullets, so you trust the ranking),
 *   • a company graph (how many recruiters / leaders / engineers exist), and
 *   • a multi-contact strategy + an ordered "application success plan" that
 *     encodes the honest fallback ladder: referral → tailor → apply → follow up
 *     → apply anyway. Never "no referral found, the end".
 *
 * All pure and deterministic — no network, no LLM, no invented numbers.
 */
import type { ReferralRole } from './referral-ranking';

export interface ContactLike {
  id: string;
  name: string;
  role: ReferralRole;
  priority: number;
  publicMember: boolean;
  sharedTech: string[];
  email: string | null;
  blog: string | null;
  twitter: string | null;
  contributions: number;
}

/** Explicit, checkable reasons this person is worth a message. */
export function whyBullets(c: ContactLike, companyName: string): string[] {
  const out: string[] = [];
  out.push(
    c.role === 'RECRUITER'
      ? 'Recruiter / talent — can route your application directly'
      : c.role === 'HIRING_MANAGER'
        ? 'Engineering leader — likely involved in hiring'
        : 'Engineer — can submit an internal referral',
  );
  out.push(
    c.publicMember
      ? `Confirmed ${companyName} employee (public GitHub org member)`
      : `Contributes to ${companyName}'s open source`,
  );
  if (c.sharedTech.length) out.push(`Shares your ${c.sharedTech.join(', ')}`);
  if (c.contributions >= 20) out.push('Active open-source contributor');
  out.push(
    c.email
      ? 'Has a public email you can use'
      : c.blog
        ? 'Reachable via their public site'
        : c.twitter
          ? 'Reachable on X'
          : 'Message via GitHub',
  );
  return out;
}

export interface OutreachGraph {
  recruiters: number;
  leaders: number;
  engineers: number;
  contactable: number; // have a public email / site / X
  total: number;
}

export function companyGraph(contacts: ContactLike[]): OutreachGraph {
  return {
    recruiters: contacts.filter((c) => c.role === 'RECRUITER').length,
    leaders: contacts.filter((c) => c.role === 'HIRING_MANAGER').length,
    engineers: contacts.filter((c) => c.role === 'ENGINEER').length,
    contactable: contacts.filter((c) => c.email || c.blog || c.twitter).length,
    total: contacts.length,
  };
}

export interface StrategyPick {
  id: string;
  name: string;
  role: ReferralRole;
}
export interface OutreachStrategy {
  primary: StrategyPick | null; // best overall — try this person first
  secondary: StrategyPick | null; // a different backup, ideally a different role
  recruiterFallback: StrategyPick | null; // the cold-outreach path when referrals go quiet
}

const pick = (c: ContactLike): StrategyPick => ({ id: c.id, name: c.name, role: c.role });

export function buildStrategy(contacts: ContactLike[]): OutreachStrategy {
  const sorted = [...contacts].sort((a, b) => b.priority - a.priority);
  const primary = sorted[0] ?? null;
  const recruiter = sorted.find((c) => c.role === 'RECRUITER') ?? null;
  // Prefer a secondary who is a DIFFERENT person and a different role/channel.
  const secondary =
    sorted.find((c) => primary && c.id !== primary.id && c.role !== primary.role) ??
    sorted.find((c) => primary && c.id !== primary.id) ??
    null;
  return {
    primary: primary ? pick(primary) : null,
    secondary: secondary ? pick(secondary) : null,
    recruiterFallback: recruiter ? pick(recruiter) : null,
  };
}

export interface PlanStep {
  step: number;
  title: string;
  detail: string;
  stars: number; // 1–5 — how much this step moves your odds
  href?: string; // an in-app action, when the step is one click
}

const starsFor = (priority: number): number =>
  priority >= 75 ? 5 : priority >= 60 ? 4 : priority >= 45 ? 3 : 2;

/**
 * The ordered play for this job. When an inside contact exists we lead with the
 * referral; when none does we still have a full plan (tailor → apply → nudge).
 * The last step is always "apply anyway" — a quiet inbox never blocks you.
 */
export function buildPlan(
  strategy: OutreachStrategy,
  opts: { jobId: string; hasContacts: boolean; primaryPriority: number },
): PlanStep[] {
  const steps: PlanStep[] = [];
  let n = 1;

  if (opts.hasContacts && strategy.primary) {
    steps.push({
      step: n++,
      title: `Ask ${strategy.primary.name} for a referral`,
      detail:
        strategy.primary.role === 'RECRUITER'
          ? 'They can route you straight to the hiring team — draft the intro below.'
          : 'A warm internal referral beats a cold application — draft the intro below.',
      stars: starsFor(opts.primaryPriority),
    });
  }

  steps.push({
    step: n++,
    title: 'Tailor your resume to this job',
    detail: 'Auto ATS keywords + 3-audience score, from your real content.',
    stars: 5,
    href: `/resumes/tailor/${opts.jobId}`,
  });

  steps.push({
    step: n++,
    title: 'Apply on the company site',
    detail: opts.hasContacts
      ? 'Apply right after the referral goes out, so your name is already familiar.'
      : 'No inside contact found yet — apply directly, then re-check referrals later.',
    stars: opts.hasContacts ? 4 : 5,
    href: `/jobs/${opts.jobId}`,
  });

  if (opts.hasContacts) {
    const followUp = strategy.recruiterFallback ?? strategy.secondary ?? strategy.primary;
    steps.push({
      step: n++,
      title: 'Follow up in ~3 days if no reply',
      detail: followUp
        ? `A short, polite nudge${followUp.role === 'RECRUITER' ? ` — ${followUp.name} (recruiter) is your best follow-up` : ''}.`
        : 'One short, polite nudge — never more.',
      stars: 4,
    });
    steps.push({
      step: n++,
      title: 'Second nudge (~7 days), then move on',
      detail: 'Two follow-ups is the ceiling. Your application still stands regardless.',
      stars: 3,
    });
  }

  return steps;
}
