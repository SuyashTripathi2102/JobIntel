/**
 * Referral ranking — turns raw public GitHub profiles into a ranked, explained
 * shortlist of the few people worth ONE thoughtful message each, and states WHY
 * for every one. Pure and deterministic: no network, no LLM, no invented facts.
 *
 * The ethic is baked in: we only rank PUBLIC profiles the person chose to make
 * visible, we never imply a relationship that doesn't exist, and the output is
 * a suggestion the user sends themselves — never bulk, never automated.
 */
import type { GitHubPerson } from './github-people';

export type ReferralRole = 'RECRUITER' | 'HIRING_MANAGER' | 'ENGINEER';

export interface RankedReferral extends GitHubPerson {
  role: ReferralRole;
  priority: number; // 0–100
  reason: string; // human-readable "why this person"
  sharedTech: string[]; // user skills we actually saw named in their bio/company
}

export interface RankOptions {
  companyName: string;
  userSkills: string[];
}

const RECRUITER = /\b(recruit|recruiter|talent|sourcer|people ops|staffing)\b/i;
const LEADER =
  /\b(founder|co-?founder|ceo|cto|vp|vice president|head of|director|eng(?:ineering)? manager|engineering lead|tech lead|team lead|lead engineer|manager|principal|staff engineer)\b/i;
const HIRING = /\b(hiring|we'?re hiring|join (?:us|our team)|open roles?|come work)\b/i;
const INDIA =
  /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|delhi|gurgaon|gurugram|noida|chennai|indore|remote)\b/i;

function inferRole(person: GitHubPerson): ReferralRole {
  const hay = `${person.bio ?? ''} ${person.company ?? ''}`;
  if (RECRUITER.test(hay)) return 'RECRUITER';
  if (LEADER.test(hay)) return 'HIRING_MANAGER';
  return 'ENGINEER';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** User skills literally named in the person's public text — never inferred. */
function sharedTech(person: GitHubPerson, userSkills: string[]): string[] {
  const hay = `${person.bio ?? ''} ${person.company ?? ''} ${person.viaRepos.join(' ')}`;
  const out: string[] = [];
  for (const skill of userSkills) {
    if (typeof skill !== 'string') continue; // never crash on a malformed profile entry
    const s = skill.trim();
    if (s.length < 2) continue;
    // token-boundary match so "react" doesn't hit "reactive"; allow .+#- in skill
    if (new RegExp(`(^|[^A-Za-z0-9+#.-])${escape(s)}([^A-Za-z0-9+#.-]|$)`, 'i').test(hay)) {
      out.push(s);
    }
  }
  return [...new Set(out)].slice(0, 4);
}

function contactPhrase(p: GitHubPerson): string {
  if (p.email) return 'reachable by public email';
  if (p.blog) return 'has a public site to reach them';
  if (p.twitter) return 'reachable on X';
  return 'message via GitHub';
}

function buildReason(
  p: GitHubPerson,
  role: ReferralRole,
  shared: string[],
  companyName: string,
): string {
  const who =
    role === 'RECRUITER'
      ? 'Recruiter / talent'
      : role === 'HIRING_MANAGER'
        ? 'Engineering leader'
        : 'Engineer';
  const belonging = p.publicMember
    ? `public member of ${companyName}'s GitHub org`
    : `contributes to ${companyName}'s repos`;
  const via = p.viaRepos.length && !p.publicMember ? ` (via ${p.viaRepos[0]})` : '';
  const stack = shared.length ? `; shares your ${shared.join(', ')}` : '';
  return `${who} — ${belonging}${via}${stack}. ${cap(contactPhrase(p))}.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Score 0–100. Priorities, in order: a CONFIRMED employee (public org member)
 * over a mere contributor; recruiters and eng leaders (who refer easily) over
 * random engineers; a real contact path; shared stack (a warmer, likelier
 * reply); and a same-region colleague. Every input is an observed public fact.
 */
function score(p: GitHubPerson, role: ReferralRole, shared: string[]): number {
  let s = 0;
  s += p.publicMember ? 45 : 15; // confirmed employee vs contributor
  if (role === 'RECRUITER') s += 12;
  else if (role === 'HIRING_MANAGER') s += 10;
  if (p.email) s += 15;
  else if (p.blog) s += 6;
  else if (p.twitter) s += 4;
  s += Math.min(20, shared.length * 5);
  if (HIRING.test(`${p.bio ?? ''}`)) s += 8;
  if (p.location && INDIA.test(p.location)) s += 4; // same region / timezone
  if (p.contributions >= 20) s += 4;
  return Math.max(0, Math.min(100, s));
}

export function rankReferrals(people: GitHubPerson[], opts: RankOptions): RankedReferral[] {
  return people
    .map((p) => {
      const role = inferRole(p);
      const shared = sharedTech(p, opts.userSkills);
      return {
        ...p,
        role,
        sharedTech: shared,
        priority: score(p, role, shared),
        reason: buildReason(p, role, shared, opts.companyName),
      };
    })
    .sort((a, b) => b.priority - a.priority);
}
