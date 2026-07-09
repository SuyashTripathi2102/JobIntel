/**
 * Job-level role classification, and the user-level fit derived from it.
 *
 * These are two different questions, and blending them is what produced nine
 * confident false recommendations on 2026-07-09 — a digital-marketing analytics
 * role scored APPLY 77 because its JD said "JavaScript", and a technical-PM
 * role scored APPLY 84 because its title said "Full Stack".
 *
 *   Classification: what IS this job?          → objective, cached per job.
 *   Fit:            is it MY kind of work?     → per user, cheap, no LLM.
 *
 * Freshness, company quality, and resume similarity may rank eligible jobs.
 * They must never make an ineligible role eligible.
 */

export type PrimaryFunction =
  | 'SOFTWARE_ENGINEERING'
  | 'DATA_ENGINEERING'
  | 'DEVOPS_SRE'
  | 'QA_TEST_ENGINEERING'
  | 'PRODUCT_MANAGEMENT'
  | 'PROJECT_PROGRAM_MANAGEMENT'
  | 'BUSINESS_ANALYTICS'
  | 'DATA_ANALYTICS'
  | 'MARKETING_GROWTH'
  | 'IMPLEMENTATION_SERVICES'
  | 'CUSTOMER_SUPPORT'
  | 'SALES_PRE_SALES'
  | 'DESIGN'
  | 'OTHER'
  | 'AMBIGUOUS';

export type RoleFamily =
  // target
  | 'FULL_STACK'
  | 'BACKEND'
  | 'NODEJS_BACKEND'
  | 'MERN'
  | 'WEB_SOFTWARE_ENGINEERING'
  | 'GENERAL_SOFTWARE_ENGINEERING'
  | 'SDE'
  // adjacent
  | 'FRONTEND'
  | 'REACT'
  | 'APPLICATION_ENGINEERING'
  | 'INTEGRATION_ENGINEERING'
  | 'SOLUTIONS_ENGINEERING'
  | 'PLATFORM_ENGINEERING'
  // normally excluded
  | 'NATIVE_ANDROID'
  | 'NATIVE_IOS'
  | 'DATA_ENGINEERING'
  | 'DATA_SCIENCE'
  | 'MACHINE_LEARNING'
  | 'DEVOPS_SRE'
  | 'MANUAL_QA'
  | 'AUTOMATION_QA'
  | 'PRODUCT_MANAGEMENT'
  | 'BUSINESS_ANALYTICS'
  | 'DATA_ANALYTICS'
  | 'DIGITAL_MARKETING'
  | 'SUPPORT'
  | 'SALES'
  | 'ENGINEERING_MANAGEMENT'
  | 'OTHER'
  | 'AMBIGUOUS';

export type CodingIntensity = 'PRIMARY' | 'SUBSTANTIAL' | 'OCCASIONAL' | 'INCIDENTAL' | 'NONE';

export type Seniority = 'INTERN' | 'JUNIOR' | 'MID' | 'SENIOR' | 'LEAD' | 'STAFF' | 'PRINCIPAL' | 'UNKNOWN';

export type TargetFit = 'TARGET' | 'ADJACENT' | 'NON_TARGET' | 'AMBIGUOUS';

/** What the classifier extracts from a JD. Objective; never user-specific. */
export interface JobClassification {
  primaryFunction: PrimaryFunction;
  roleFamily: RoleFamily;
  specialization: string[];
  codingIntensity: CodingIntensity;
  /** 0–100: how confident that building software is the core of this job. */
  developmentConfidence: number;
  seniority: Seniority;
  minimumYears: number | null;
  maximumYears: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  developmentEvidence: string[];
  nonDevelopmentEvidence: string[];
  classificationReason: string;
}

/** Which families this user is actually looking for. */
export interface RoleProfile {
  targetFamilies: RoleFamily[];
  adjacentFamilies: RoleFamily[];
  excludedFamilies: RoleFamily[];
  yearsExperience: number;
}

/**
 * Families that name no technology. A "Software Engineer" or "SDE" role is
 * target ONLY when its stack is yours — otherwise the label admits Rust SREs,
 * Android engineers and LLM researchers as 100% relevant.
 */
const CATCH_ALL_FAMILIES: RoleFamily[] = [
  'SDE',
  'GENERAL_SOFTWARE_ENGINEERING',
  'WEB_SOFTWARE_ENGINEERING',
];

/** Suyash's stack, matched against a JD's stated requirements. */
const USER_STACK = [
  'node', 'express', 'react', 'javascript', 'typescript', 'es6',
  'rest', 'api', 'mysql', 'mongodb', 'html', 'css', 'socket.io', 'jwt',
  'aws', 'nginx', 'pm2', 'git', 'redis', 'postgres',
];

/**
 * Technologies that read as "your stack" by substring but are a different
 * discipline: "React Native" contains "react", "Java" contains nothing of
 * yours yet sits next to "JavaScript" in a list.
 */
const FOREIGN_STACK = [
  'react native', 'android', 'ios', 'xcode', 'gradle', 'swift', 'kotlin',
  'java', 'spring', 'hibernate', 'j2ee', 'python', 'django', 'flask',
  'golang', 'rust', 'kafka', 'spark', 'hadoop', 'kubernetes', 'terraform',
  'llm', 'openai', 'anthropic', 'langchain', 'pytorch', 'tensorflow',
  'power bi', 'tableau', 'sap', 'salesforce', 'cassandra',
];

/**
 * Technologies that identify a whole discipline, not a transferable tool. Their
 * presence in the REQUIRED stack means a neutrally-titled "Software Engineer"
 * role belongs to mobile, ML, or systems — adjacent, not target.
 */
const DISCIPLINE_MARKERS = [
  'react native', 'android', 'ios', 'swift', 'kotlin', 'flutter',
  'java', 'spring', 'j2ee', 'python', 'django', 'golang', 'rust', 'scala', 'c++',
  'llm', 'llms', 'openai', 'anthropic', 'pytorch', 'tensorflow', 'langchain',
  'kafka', 'spark', 'hadoop', 'power bi', 'tableau', 'sap', 'salesforce',
];

export const DEFAULT_ROLE_PROFILE: Omit<RoleProfile, 'yearsExperience'> = {
  targetFamilies: [
    'FULL_STACK',
    'BACKEND',
    'NODEJS_BACKEND',
    'MERN',
    'WEB_SOFTWARE_ENGINEERING',
    'GENERAL_SOFTWARE_ENGINEERING',
    'SDE',
  ],
  adjacentFamilies: [
    'FRONTEND',
    'REACT',
    'APPLICATION_ENGINEERING',
    'INTEGRATION_ENGINEERING',
    'SOLUTIONS_ENGINEERING',
    'PLATFORM_ENGINEERING',
  ],
  excludedFamilies: [
    'NATIVE_ANDROID',
    'NATIVE_IOS',
    // Genuine engineering with PRIMARY coding — excluded because it is not the
    // Node/MERN/full-stack path, never because it "isn't development".
    'DATA_ENGINEERING',
    'DATA_SCIENCE',
    'MACHINE_LEARNING',
    'DEVOPS_SRE',
    'MANUAL_QA',
    'AUTOMATION_QA',
    'PRODUCT_MANAGEMENT',
    'BUSINESS_ANALYTICS',
    'DATA_ANALYTICS',
    'DIGITAL_MARKETING',
    'SUPPORT',
    'SALES',
    'ENGINEERING_MANAGEMENT',
  ],
};

const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ');

const TARGET_MIN_CONFIDENCE = 70;
const ADJACENT_MIN_CONFIDENCE = 80;
const REVIEW_MIN_CONFIDENCE = 50;
const BUILDS_SOFTWARE: CodingIntensity[] = ['PRIMARY', 'SUBSTANTIAL'];

const normalize = (s: string) => s.toLowerCase().trim();

/**
 * Word-boundary match. Plain `includes` claims "JavaScript" is "Java" and
 * "TypeScript" is nothing at all — the first is a different language, and the
 * mistake silently zeroed the stack fit of every JS role.
 */
function mentions(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Specialization fit: how much of the JD's REQUIRED stack is your stack.
 * Null when the JD names no technologies — an honest "unknown", not a zero.
 *
 * "React Native" is not React; "Java" beside "JavaScript" is not JavaScript.
 * Foreign technologies are checked first, so a substring can never smuggle a
 * different discipline in.
 */
export function specializationFit(c: JobClassification): number | null {
  const skills = [...c.requiredSkills, ...c.specialization].map(normalize);
  if (skills.length === 0) return null;

  let matched = 0;
  for (const skill of skills) {
    // Foreign first: "React Native" is not React, "Java" is not JavaScript.
    if (FOREIGN_STACK.some((f) => mentions(skill, f))) continue;
    if (USER_STACK.some((u) => mentions(skill, u) || skill.startsWith(u))) matched++;
  }
  return Math.round((matched / skills.length) * 100);
}

/**
 * Which bucket this job falls into for this user. Title is never consulted.
 *
 * A catch-all family ("Software Engineer", "SDE") only counts as TARGET when
 * its stack is actually yours. Otherwise every Rust SRE and LLM researcher
 * with the word "Engineer" in the family reads as a perfect match.
 */
export function targetFit(c: JobClassification, p: RoleProfile): TargetFit {
  if (c.primaryFunction === 'AMBIGUOUS' || c.roleFamily === 'AMBIGUOUS') return 'AMBIGUOUS';
  if (p.excludedFamilies.includes(c.roleFamily)) return 'NON_TARGET';
  if (p.targetFamilies.includes(c.roleFamily)) {
    // A generic "Software Engineer" whose JD requires React Native, Python or
    // Rust is a mobile / ML / systems role wearing a neutral title.
    if (CATCH_ALL_FAMILIES.includes(c.roleFamily) && namesForeignDiscipline(c)) return 'ADJACENT';
    return 'TARGET';
  }
  if (p.adjacentFamilies.includes(c.roleFamily)) return 'ADJACENT';
  return 'NON_TARGET';
}

/** Does the REQUIRED stack name a different engineering discipline outright? */
function namesForeignDiscipline(c: JobClassification): boolean {
  const skills = [...c.requiredSkills, ...c.specialization].map(normalize);
  return skills.some((s) => DISCIPLINE_MARKERS.some((m) => mentions(s, m)));
}

/** 0–100: how closely this role matches the families you are searching for. */
export function targetRoleFit(c: JobClassification, p: RoleProfile): number {
  const fit = targetFit(c, p);
  const base = fit === 'TARGET' ? 100 : fit === 'ADJACENT' ? 65 : fit === 'AMBIGUOUS' ? 40 : 10;
  const stack = specializationFit(c);
  // An adjacent role with your stack beats an adjacent role without it.
  if (fit === 'ADJACENT' && stack !== null) return Math.round(base * (0.6 + 0.4 * (stack / 100)));
  return base;
}

/**
 * Legacy blended number. developmentConfidence answers "is this software?",
 * targetRoleFit answers "is this my role?", specializationFit answers "is this
 * my stack?". Keep them apart — a React Native role is 100% software and not
 * 100% yours.
 */
export function roleRelevance(c: JobClassification, p: RoleProfile): number {
  const codingWeight =
    c.codingIntensity === 'PRIMARY'
      ? 1
      : c.codingIntensity === 'SUBSTANTIAL'
        ? 0.8
        : c.codingIntensity === 'OCCASIONAL'
          ? 0.4
          : 0.1;
  return Math.round(c.developmentConfidence * codingWeight * (targetRoleFit(c, p) / 100));
}

export interface ExperienceVerdict {
  /** false = hard SKIP on seniority grounds. */
  eligible: boolean;
  /** true = may reach CONSIDER but never APPLY automatically. */
  capsAtConsider: boolean;
  reason: string;
}

/**
 * Experience is a band, not an equation. Companies write "3 years" and hire a
 * strong two-year candidate — but a 5-year requirement is a different job.
 */
export function experienceVerdict(c: JobClassification, years: number): ExperienceVerdict {
  const senior: Seniority[] = ['SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL'];
  const min = c.minimumYears;

  // Seniority language outranks a soft minimum, unless the JD's own number
  // contradicts it (some companies title a 2-year role "Senior").
  if (senior.includes(c.seniority) && (min === null || min > years + 1)) {
    return {
      eligible: false,
      capsAtConsider: false,
      reason: `${c.seniority.toLowerCase()} role — beyond ${years} years of experience`,
    };
  }

  if (min === null) {
    return { eligible: true, capsAtConsider: false, reason: 'no explicit experience requirement' };
  }

  const asks = c.maximumYears ? `${min}–${c.maximumYears} years` : `${min}+ years`;
  const gap = min - years;
  if (gap <= 0) {
    return { eligible: true, capsAtConsider: false, reason: `JD requests ${asks}; you have ~${years}` };
  }
  if (gap === 1) {
    return {
      eligible: true,
      capsAtConsider: true,
      reason: `Experience stretch: JD requests ${asks}; your profile has approximately ${years} years`,
    };
  }
  return {
    eligible: false,
    capsAtConsider: false,
    reason: `JD requests ${asks}; your profile has approximately ${years} years — ${gap} years short`,
  };
}

/**
 * Why a job was admitted or refused. Never collapse these — "not a development
 * role" said about an Android engineer is false, and a user who catches the
 * system lying once stops trusting the explanations that are true.
 */
export type EligibilityCode =
  | 'TARGET_ROLE_ELIGIBLE'
  | 'TARGET_ROLE_EXPERIENCE_STRETCH'
  | 'TARGET_ROLE_TOO_SENIOR'
  /** Right role, wrong stack — decided by resume scoring, not by the gate. */
  | 'TARGET_ROLE_WEAK_STACK'
  | 'DEVELOPMENT_WRONG_SPECIALIZATION'
  | 'NOT_DEVELOPMENT'
  | 'LOW_CODING_RESPONSIBILITY'
  | 'LOW_CONFIDENCE'
  | 'AMBIGUOUS_NEEDS_REVIEW';

export interface Eligibility {
  /** Passes every hard gate — may proceed to personalized resume scoring. */
  eligible: boolean;
  /** Genuinely uncertain: show in Needs Review, never auto-APPLY, never push. */
  needsReview: boolean;
  code: EligibilityCode;
  fit: TargetFit;
  roleRelevance: number;
  /** Is hands-on development core to this job? (0–100, from the classifier.) */
  developmentConfidence: number;
  /** Does this role match the families I search for? (0–100.) */
  targetRoleFit: number;
  /** Is the JD's required stack my stack? (0–100, null when none stated.) */
  specializationFit: number | null;
  capsAtConsider: boolean;
  reason: string;
}

/**
 * What the user should DO, as opposed to what the system concluded.
 *
 * A yellow CONSIDER on the best job CareerOS has ever found reads as "skip".
 * The verdict stays factual; this says whether to act. Derived from the stored
 * decision — never regenerated independently by Telegram or the dashboard.
 */
export type ActionRecommendation =
  | 'APPLY_NOW'
  | 'WORTH_APPLYING'
  | 'REVIEW_FIRST'
  | 'LOW_PRIORITY'
  | 'SKIP';

export function actionFor(input: {
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP' | 'NEEDS_REVIEW';
  targetRoleFit: number;
  specializationFit: number | null;
  resumeFit: number;
  fit: TargetFit;
  capsAtConsider: boolean;
}): ActionRecommendation {
  if (input.verdict === 'APPLY') return 'APPLY_NOW';
  if (input.verdict === 'SKIP') return 'SKIP';
  if (input.verdict === 'NEEDS_REVIEW') return 'REVIEW_FIRST';

  // CONSIDER: a one-year experience stretch on your exact role and stack is a
  // job worth applying to, not a job worth skipping.
  if (input.targetRoleFit >= 85 && input.resumeFit >= 70 && input.capsAtConsider) {
    return 'WORTH_APPLYING';
  }
  if (input.specializationFit !== null && input.specializationFit < 50) return 'LOW_PRIORITY';
  if (input.fit === 'ADJACENT') return 'REVIEW_FIRST';
  return input.targetRoleFit >= 85 && input.resumeFit >= 70 ? 'WORTH_APPLYING' : 'REVIEW_FIRST';
}

/**
 * The hard gate that runs BEFORE similarity, before resume scoring, before any
 * weighted module. Nothing downstream can overturn it.
 */
export function eligibility(c: JobClassification, p: RoleProfile): Eligibility {
  const fit = targetFit(c, p);
  const relevance = roleRelevance(c, p);
  const builds = BUILDS_SOFTWARE.includes(c.codingIntensity);
  const exp = experienceVerdict(c, p.yearsExperience);

  const base = {
    fit,
    roleRelevance: relevance,
    developmentConfidence: c.developmentConfidence,
    targetRoleFit: targetRoleFit(c, p),
    specializationFit: specializationFit(c),
    capsAtConsider: exp.capsAtConsider,
  };

  // "Builds software" is decided by what the person does, not by which
  // department owns them. An SRE who writes automation daily is engineering.
  const genuineEngineering = builds && c.developmentConfidence >= TARGET_MIN_CONFIDENCE;

  if (fit === 'NON_TARGET') {
    // Distinguish "not software" from "software, but not your specialization".
    // Telling an Android engineer that Android isn't software is how a user
    // stops believing every other explanation the system gives.
    return {
      ...base,
      eligible: false,
      needsReview: false,
      code: genuineEngineering ? 'DEVELOPMENT_WRONG_SPECIALIZATION' : 'NOT_DEVELOPMENT',
      reason: genuineEngineering
        ? `genuine ${humanize(c.roleFamily)} role, but outside your Node.js/MERN/full-stack targets`
        : `${humanize(c.primaryFunction)} role — building software is not the core responsibility`,
    };
  }

  if (!builds) {
    // A job with no coding and no development confidence is not "uncertain" —
    // it is a sales or account-management role the model declined to name.
    // Needs Review must hold genuine ambiguity, or it becomes a second inbox.
    const clearlyNotDevelopment = c.codingIntensity === 'NONE' && c.developmentConfidence < 20;
    const review = fit === 'AMBIGUOUS' && !clearlyNotDevelopment;
    return {
      ...base,
      eligible: false,
      needsReview: review,
      code: review ? 'AMBIGUOUS_NEEDS_REVIEW' : clearlyNotDevelopment ? 'NOT_DEVELOPMENT' : 'LOW_CODING_RESPONSIBILITY',
      reason: clearlyNotDevelopment
        ? 'no coding responsibility stated — not a software development role'
        : `coding is ${humanize(c.codingIntensity)} here, not a primary responsibility`,
    };
  }

  // Seniority and years are hard, and they come before review triage: a role
  // you cannot get should not consume your attention in the review queue.
  if (!exp.eligible) {
    return { ...base, eligible: false, needsReview: false, code: 'TARGET_ROLE_TOO_SENIOR', reason: exp.reason };
  }

  if (fit === 'AMBIGUOUS' || c.developmentConfidence < REVIEW_MIN_CONFIDENCE) {
    return {
      ...base,
      eligible: false,
      needsReview: true,
      code: 'AMBIGUOUS_NEEDS_REVIEW',
      reason: c.classificationReason,
    };
  }

  const threshold = fit === 'TARGET' ? TARGET_MIN_CONFIDENCE : ADJACENT_MIN_CONFIDENCE;
  if (c.developmentConfidence < threshold) {
    return {
      ...base,
      eligible: false,
      needsReview: true,
      code: 'LOW_CONFIDENCE',
      reason: `${c.developmentConfidence}% development confidence — below the ${threshold}% bar for ${humanize(fit)} roles`,
    };
  }

  // Adjacent families must be hands-on, not merely software-adjacent.
  if (fit === 'ADJACENT' && c.codingIntensity !== 'PRIMARY') {
    return {
      ...base,
      eligible: false,
      needsReview: true,
      code: 'AMBIGUOUS_NEEDS_REVIEW',
      reason: `adjacent role family with ${humanize(c.codingIntensity)} coding — needs a human look`,
    };
  }

  return {
    ...base,
    eligible: true,
    needsReview: false,
    code: exp.capsAtConsider ? 'TARGET_ROLE_EXPERIENCE_STRETCH' : 'TARGET_ROLE_ELIGIBLE',
    reason: exp.reason,
  };
}
