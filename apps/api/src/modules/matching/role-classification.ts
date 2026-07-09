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

/** Which bucket this job falls into for this user. Title is never consulted. */
export function targetFit(c: JobClassification, p: RoleProfile): TargetFit {
  if (c.primaryFunction === 'AMBIGUOUS' || c.roleFamily === 'AMBIGUOUS') return 'AMBIGUOUS';
  if (p.excludedFamilies.includes(c.roleFamily)) return 'NON_TARGET';
  if (p.targetFamilies.includes(c.roleFamily)) return 'TARGET';
  if (p.adjacentFamilies.includes(c.roleFamily)) return 'ADJACENT';
  return 'NON_TARGET';
}

/**
 * Role relevance, reported SEPARATELY from resume match. A job can resemble
 * your resume (82%) while being the wrong kind of work (22%).
 */
export function roleRelevance(c: JobClassification, p: RoleProfile): number {
  const fit = targetFit(c, p);
  const codingWeight =
    c.codingIntensity === 'PRIMARY'
      ? 1
      : c.codingIntensity === 'SUBSTANTIAL'
        ? 0.8
        : c.codingIntensity === 'OCCASIONAL'
          ? 0.4
          : 0.1;
  const fitWeight = fit === 'TARGET' ? 1 : fit === 'ADJACENT' ? 0.75 : fit === 'AMBIGUOUS' ? 0.5 : 0.2;
  return Math.round(c.developmentConfidence * codingWeight * fitWeight);
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

  const gap = min - years;
  if (gap <= 0) return { eligible: true, capsAtConsider: false, reason: `asks ${min}y, you have ${years}y` };
  if (gap === 1) {
    return {
      eligible: true,
      capsAtConsider: true,
      reason: `asks ${min}y vs your ${years}y — a stretch; strong stack fit required`,
    };
  }
  return {
    eligible: false,
    capsAtConsider: false,
    reason: `asks ${min}y vs your ${years}y — ${gap} years short`,
  };
}

export interface Eligibility {
  /** Passes every hard gate — may proceed to personalized resume scoring. */
  eligible: boolean;
  /** Genuinely uncertain: show in Needs Review, never auto-APPLY, never push. */
  needsReview: boolean;
  fit: TargetFit;
  roleRelevance: number;
  capsAtConsider: boolean;
  reason: string;
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

  const base = { fit, roleRelevance: relevance, capsAtConsider: exp.capsAtConsider };

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
      reason: genuineEngineering
        ? `genuine software engineering, but ${humanize(c.roleFamily)} is outside your target families`
        : `${humanize(c.primaryFunction)} role — building software is not the core responsibility`,
    };
  }

  if (!builds) {
    return {
      ...base,
      eligible: false,
      needsReview: fit === 'AMBIGUOUS',
      reason: `coding is ${humanize(c.codingIntensity)} here, not a primary responsibility`,
    };
  }

  // Seniority and years are hard, and they come before review triage: a role
  // you cannot get should not consume your attention in the review queue.
  if (!exp.eligible) {
    return { ...base, eligible: false, needsReview: false, reason: exp.reason };
  }

  if (fit === 'AMBIGUOUS' || c.developmentConfidence < REVIEW_MIN_CONFIDENCE) {
    return { ...base, eligible: false, needsReview: true, reason: c.classificationReason };
  }

  const threshold = fit === 'TARGET' ? TARGET_MIN_CONFIDENCE : ADJACENT_MIN_CONFIDENCE;
  if (c.developmentConfidence < threshold) {
    return {
      ...base,
      eligible: false,
      needsReview: true,
      reason: `${c.developmentConfidence}% development confidence — below the ${threshold}% bar for ${humanize(fit)} roles`,
    };
  }

  // Adjacent families must be hands-on, not merely software-adjacent.
  if (fit === 'ADJACENT' && c.codingIntensity !== 'PRIMARY') {
    return {
      ...base,
      eligible: false,
      needsReview: true,
      reason: `adjacent role family with ${humanize(c.codingIntensity)} coding — needs a human look`,
    };
  }

  return { ...base, eligible: true, needsReview: false, reason: exp.reason };
}
