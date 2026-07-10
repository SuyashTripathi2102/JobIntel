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
  /** From the user's CONFIRMED resume profile — not a hardcoded guess. */
  skills?: string[];
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

/**
 * Fallback stack, used only when the active resume has no confirmed skills.
 * The real list comes from the user's reviewed profile.
 */
const USER_STACK = [
  'JavaScript', 'Node.js', 'Express.js', 'React.js', 'REST APIs', 'Socket.io',
  'MySQL', 'JWT', 'OAuth', 'AWS', 'Nginx', 'PM2', 'Git', 'HTML5', 'CSS3',
];

/**
 * Canonical technologies that identify a whole discipline, not a transferable
 * tool. Their presence in the REQUIRED stack means a neutrally-titled
 * "Software Engineer" role belongs to mobile, ML, or systems — adjacent, not
 * target.
 */
const DISCIPLINE_MARKERS = new Set([
  'react-native', 'android', 'ios', 'swift', 'kotlin', 'flutter',
  'java', 'python', 'go', 'rust', 'scala', 'cpp', 'csharp', 'dotnet', 'php', 'ruby',
  'llm', 'ml', 'kafka', 'spark', 'hadoop', 'powerbi', 'tableau', 'sap', 'salesforce',
]);

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

/**
 * Technology names are not substrings of one another, no matter what
 * `String.includes` thinks. "JavaScript".includes("java") is true, and that one
 * character sequence silently zeroed the stack fit of every JavaScript role
 * until 2026-07-10.
 *
 * Every skill is reduced to a canonical token and compared by EQUALITY. No
 * substring matching anywhere: "react" never matches "react native", "c" never
 * matches "c++" or "css", "go" never matches "mongodb".
 */
export const TECH_ALIASES: Record<string, string> = {
  // JavaScript family
  js: 'javascript', javascript: 'javascript', 'java script': 'javascript',
  ecmascript: 'javascript', es6: 'javascript', 'es6+': 'javascript', es2015: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  node: 'node', nodejs: 'node', 'node.js': 'node', 'node js': 'node',
  express: 'express', expressjs: 'express', 'express.js': 'express', 'express js': 'express',
  react: 'react', reactjs: 'react', 'react.js': 'react', 'react js': 'react',
  'react native': 'react-native', 'react-native': 'react-native', reactnative: 'react-native',
  nextjs: 'nextjs', 'next.js': 'nextjs',
  // Other languages that collide by substring
  java: 'java', 'core java': 'java', j2ee: 'java', spring: 'java', 'spring boot': 'java',
  hibernate: 'java', kotlin: 'kotlin', swift: 'swift',
  c: 'c', 'c++': 'cpp', cpp: 'cpp', 'c#': 'csharp', csharp: 'csharp',
  '.net': 'dotnet', dotnet: 'dotnet', 'asp.net': 'dotnet',
  go: 'go', golang: 'go', rust: 'rust', scala: 'scala',
  python: 'python', django: 'python', flask: 'python', fastapi: 'python',
  php: 'php', ruby: 'ruby', rails: 'ruby',
  // Data stores — "sql" alone is not MySQL
  sql: 'sql', mysql: 'mysql', postgres: 'postgres', postgresql: 'postgres',
  mongodb: 'mongodb', mongo: 'mongodb', redis: 'redis', cassandra: 'cassandra',
  elasticsearch: 'elasticsearch', aerospike: 'aerospike', dynamodb: 'dynamodb',
  // Web / API
  html: 'html', html5: 'html', css: 'css', css3: 'css', sass: 'css',
  rest: 'rest', 'rest api': 'rest', 'rest apis': 'rest', 'restful api': 'rest',
  'restful apis': 'rest', api: 'rest', apis: 'rest',
  graphql: 'graphql', 'socket.io': 'socketio', socketio: 'socketio', websockets: 'socketio',
  jwt: 'jwt', oauth: 'oauth', 'oauth 2.0': 'oauth',
  // Infra
  aws: 'aws', ec2: 'aws', azure: 'azure', gcp: 'gcp', 'google cloud': 'gcp',
  docker: 'docker', kubernetes: 'kubernetes', k8s: 'kubernetes',
  nginx: 'nginx', pm2: 'pm2', terraform: 'terraform', jenkins: 'jenkins',
  git: 'git', linux: 'linux',
  // Mobile / ML / data — discipline markers
  android: 'android', ios: 'ios', xcode: 'ios', gradle: 'android', flutter: 'flutter',
  llm: 'llm', llms: 'llm', openai: 'llm', anthropic: 'llm', langchain: 'llm',
  crewai: 'llm', 'prompt engineering': 'llm',
  pytorch: 'ml', tensorflow: 'ml', 'machine learning': 'ml',
  kafka: 'kafka', spark: 'spark', hadoop: 'hadoop', airflow: 'airflow', dbt: 'dbt',
  'power bi': 'powerbi', powerbi: 'powerbi', tableau: 'tableau',
  sap: 'sap', salesforce: 'salesforce',
};

/** Canonical token for a skill string, or null when we do not recognise it. */
export function canonicalTech(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/\((.*?)\)/g, ' ') // "OTP (Twilio)" -> "OTP"
    .replace(/[^a-z0-9+#. -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (TECH_ALIASES[s]) return TECH_ALIASES[s];

  // Try the longest known alias that appears as a whole phrase — but never an
  // AMBIGUOUS one: "go to market strategy" is not Golang, and "express
  // delivery logistics" is not Express.js.
  for (const alias of ALIASES_BY_LENGTH) {
    if (AMBIGUOUS_ALIASES.has(alias)) continue;
    const re = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (re.test(s)) return TECH_ALIASES[alias];
  }
  return null;
}

/** Aliases that are ordinary English words. Only an exact match counts. */
export const AMBIGUOUS_ALIASES = new Set([
  'go', 'c', 'api', 'apis', 'express', 'node', 'rest', 'sql', 'ml', 'spring',
  'swift', 'rails', 'flask', 'ruby', 'php', 'java', 'react', 'js', 'ts',
]);

const ALIASES_BY_LENGTH = Object.keys(TECH_ALIASES).sort((a, b) => b.length - a.length);

/**
 * Domain transferability — NOT skill knowledge.
 *
 * A technology you have never used, that a technology you HAVE used partially
 * prepares you for. Half credit, and it must never be rendered as a matched
 * skill: knowing MySQL does not mean you know MongoDB's document modeling,
 * aggregation pipelines, or embed-vs-reference tradeoffs. It means a recruiter
 * asking about MongoDB is not asking a stranger about databases.
 *
 * The bar for an entry here is "same paradigm, transferable mental model".
 * `redis: ['mysql']` used to live here and was wrong — an in-memory key-value
 * cache shares nothing operational with a relational database.
 */
const TRANSFERABLE: Record<string, string[]> = {
  'react-native': ['react', 'javascript', 'flutter'],
  postgres: ['mysql', 'sql'],
  sql: ['mysql', 'postgres'],
  mongodb: ['mysql'],
  typescript: ['javascript'],
  nextjs: ['react'],
  graphql: ['rest'],
  azure: ['aws'],
  gcp: ['aws'],
};

/** A JD technology reached only through adjacent experience, never directly. */
export interface TransferableMatch {
  /** The technology the JD asked for, as the JD wrote it. */
  skill: string;
  /** The skill on the resume that partially prepares for it. */
  via: string;
  /** Rendered verbatim. Says "no evidence" out loud so no UI can imply otherwise. */
  note: string;
}

export interface SpecializationBreakdown {
  /** null when the JD names no technologies — an honest unknown, not a zero. */
  fit: number | null;
  /** On the resume. Direct evidence. */
  strong: string[];
  /** NOT on the resume. Half credit for adjacency; never a match. */
  transferable: TransferableMatch[];
  missing: string[];
}

/**
 * Specialization fit, with its working shown. A bare "64%" is another magic
 * number; this says which technologies earned it and which cost it.
 */
export function specializationBreakdown(
  c: JobClassification,
  userSkills: string[],
): SpecializationBreakdown {
  // canonical token -> the skill as the USER wrote it, for display in `via`.
  const mine = new Map<string, string>();
  for (const s of userSkills) {
    const t = canonicalTech(s);
    if (t && !mine.has(t)) mine.set(t, s);
  }

  const jd = [...new Set([...c.requiredSkills, ...c.specialization])]
    .map((s) => ({ raw: s, tech: canonicalTech(s) }))
    .filter((x): x is { raw: string; tech: string } => x.tech !== null);

  if (jd.length === 0) return { fit: null, strong: [], transferable: [], missing: [] };

  const strong: string[] = [];
  const transferable: TransferableMatch[] = [];
  const missing: string[] = [];

  for (const { raw, tech } of jd) {
    if (mine.has(tech)) {
      strong.push(raw);
      continue;
    }
    const bridge = (TRANSFERABLE[tech] ?? []).find((t) => mine.has(t));
    if (bridge) {
      const via = mine.get(bridge)!;
      transferable.push({
        skill: raw,
        via,
        note: `related experience through ${via}; no confirmed ${raw} evidence`,
      });
    } else {
      missing.push(raw);
    }
  }

  const fit = Math.round(((strong.length + 0.5 * transferable.length) / jd.length) * 100);
  return { fit, strong, transferable, missing };
}

/** Specialization fit only. See specializationBreakdown() for the working. */
export function specializationFit(c: JobClassification, userSkills = USER_STACK): number | null {
  return specializationBreakdown(c, userSkills).fit;
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
  return [...c.requiredSkills, ...c.specialization].some((s) => {
    const tech = canonicalTech(s);
    return tech !== null && DISCIPLINE_MARKERS.has(tech);
  });
}

/** 0–100: how closely this role matches the families you are searching for. */
export function targetRoleFit(c: JobClassification, p: RoleProfile): number {
  const fit = targetFit(c, p);
  const base = fit === 'TARGET' ? 100 : fit === 'ADJACENT' ? 65 : fit === 'AMBIGUOUS' ? 40 : 10;
  const stack = specializationFit(c, p.skills ?? USER_STACK);
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
  /** Rejected for being BELOW the user's level (intern/trainee), not above it. */
  belowLevel: boolean;
  reason: string;
}

/**
 * Experience is a band, not an equation. Companies write "3 years" and hire a
 * strong two-year candidate — but a 5-year requirement is a different job.
 */
export function experienceVerdict(c: JobClassification, years: number): ExperienceVerdict {
  const senior: Seniority[] = ['SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL'];
  const min = c.minimumYears;

  // The floor. The gate rejected roles above the user's level and let ones
  // below it through, so an internship reached a two-year engineer's Telegram
  // (2026-07-10). An intern/trainee posting is a downgrade, not a match — the
  // strongest signal being that these roles state no minimum experience
  // precisely because they expect none. Never eligible; never a notification.
  if (c.seniority === 'INTERN' && years >= 1) {
    return {
      eligible: false,
      capsAtConsider: false,
      belowLevel: true,
      reason: `internship — below your ${years} years of experience`,
    };
  }

  // Seniority language outranks a soft minimum, unless the JD's own number
  // contradicts it (some companies title a 2-year role "Senior").
  if (senior.includes(c.seniority) && (min === null || min > years + 1)) {
    return {
      eligible: false,
      capsAtConsider: false,
      belowLevel: false,
      reason: `${c.seniority.toLowerCase()} role — beyond ${years} years of experience`,
    };
  }

  if (min === null) {
    return {
      eligible: true,
      capsAtConsider: false,
      belowLevel: false,
      reason: 'no explicit experience requirement',
    };
  }

  const asks = c.maximumYears ? `${min}–${c.maximumYears} years` : `${min}+ years`;
  const gap = min - years;
  if (gap <= 0) {
    return {
      eligible: true,
      capsAtConsider: false,
      belowLevel: false,
      reason: `JD requests ${asks}; you have ~${years}`,
    };
  }
  if (gap === 1) {
    return {
      eligible: true,
      capsAtConsider: true,
      belowLevel: false,
      reason: `Experience stretch: JD requests ${asks}; your profile has approximately ${years} years`,
    };
  }
  return {
    eligible: false,
    capsAtConsider: false,
    belowLevel: false,
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
  /** Below the user's level — internship / trainee. */
  | 'TARGET_ROLE_BELOW_LEVEL'
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
    specializationFit: specializationFit(c, p.skills ?? USER_STACK),
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
  // you cannot get — or should not want — should not consume review attention.
  if (!exp.eligible) {
    return {
      ...base,
      eligible: false,
      needsReview: false,
      code: exp.belowLevel ? 'TARGET_ROLE_BELOW_LEVEL' : 'TARGET_ROLE_TOO_SENIOR',
      reason: exp.reason,
    };
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
