import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER } from '../ai/llm.provider';
import type { LlmProvider } from '../ai/llm.provider';
import type {
  CodingIntensity,
  JobClassification,
  PrimaryFunction,
  RoleFamily,
  Seniority,
} from './role-classification';

/**
 * Bump when the prompt or the taxonomy changes — stored classifications from
 * an older version must be recomputed rather than trusted.
 */
export const CLASSIFIER_VERSION = 1;

/** Batch size per LLM call. JDs are long; five keeps the response parseable. */
const CLASSIFY_BATCH = 5;

const PRIMARY_FUNCTIONS: PrimaryFunction[] = [
  'SOFTWARE_ENGINEERING', 'DATA_ENGINEERING', 'DEVOPS_SRE', 'QA_TEST_ENGINEERING',
  'PRODUCT_MANAGEMENT', 'PROJECT_PROGRAM_MANAGEMENT', 'BUSINESS_ANALYTICS', 'DATA_ANALYTICS',
  'MARKETING_GROWTH', 'IMPLEMENTATION_SERVICES', 'CUSTOMER_SUPPORT', 'SALES_PRE_SALES',
  'DESIGN', 'OTHER', 'AMBIGUOUS',
];

const ROLE_FAMILIES: RoleFamily[] = [
  'FULL_STACK', 'BACKEND', 'NODEJS_BACKEND', 'MERN', 'WEB_SOFTWARE_ENGINEERING',
  'GENERAL_SOFTWARE_ENGINEERING', 'SDE', 'FRONTEND', 'REACT', 'APPLICATION_ENGINEERING',
  'INTEGRATION_ENGINEERING', 'SOLUTIONS_ENGINEERING', 'PLATFORM_ENGINEERING',
  'NATIVE_ANDROID', 'NATIVE_IOS', 'DATA_SCIENCE', 'MACHINE_LEARNING', 'DEVOPS_SRE',
  'MANUAL_QA', 'AUTOMATION_QA', 'PRODUCT_MANAGEMENT', 'BUSINESS_ANALYTICS', 'DATA_ANALYTICS',
  'DIGITAL_MARKETING', 'SUPPORT', 'SALES', 'ENGINEERING_MANAGEMENT', 'OTHER', 'AMBIGUOUS',
];

const CODING_INTENSITIES: CodingIntensity[] = ['PRIMARY', 'SUBSTANTIAL', 'OCCASIONAL', 'INCIDENTAL', 'NONE'];
const SENIORITIES: Seniority[] = ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL', 'UNKNOWN'];

const SYSTEM = `You classify job descriptions objectively. You describe what the job IS.
You never judge whether it suits any particular candidate — that is decided elsewhere.`;

const PROMPT = `Classify each job below from its FULL description: responsibilities, requirements,
technologies, deliverables, and seniority language. The TITLE IS THE WEAKEST SIGNAL — companies
name roles inconsistently.

Two failures to avoid, both real:
- "Analytics and Tag Manager Implementation Specialist" mentions JavaScript and APIs, but the work
  is configuring Google Tag Manager for a digital marketing team. It is MARKETING_GROWTH, not
  SOFTWARE_ENGINEERING. Technology overlap is not software development.
- "Full Stack Builder" sounds like a developer role, but its JD asks for a "technical PM" with
  "product sense" who "should be able to read code". Reading code is not writing it. That is
  PRODUCT_MANAGEMENT.

Conversely, "Member of Technical Staff", "Product Engineer", "SDE", "Application Developer" and
"Founding Engineer" are often genuine hands-on software roles. Judge the responsibilities.

For EACH job return:
- primaryFunction: one of ${PRIMARY_FUNCTIONS.join(' | ')}
- roleFamily: one of ${ROLE_FAMILIES.join(' | ')}
- specialization: short tags, e.g. ["WEB","BACKEND"]
- codingIntensity: ${CODING_INTENSITIES.join(' | ')}
    PRIMARY = writing production code is the core of the job
    SUBSTANTIAL = codes most days, alongside other duties
    OCCASIONAL = scripts, configuration, queries
    INCIDENTAL = reads code, does not write it
    NONE
- developmentConfidence: 0-100, how certain that BUILDING SOFTWARE is the core responsibility
- seniority: ${SENIORITIES.join(' | ')}
- minimumYears / maximumYears: integers from the JD text, null when unstated
- requiredSkills / preferredSkills: technologies named in the JD
- responsibilities: up to 5 verbatim-ish phrases
- developmentEvidence: quotes showing hands-on building (may be empty)
- nonDevelopmentEvidence: quotes showing the work is NOT building software (may be empty)
- classificationReason: one sentence, citing evidence

Use AMBIGUOUS for primaryFunction/roleFamily only when the JD genuinely does not say what the
person will do. Do not guess.

Return JSON exactly: {"jobs":[{"jobId":"...", ...}]}

JOBS:
`;

export interface ClassifiedJob extends JobClassification {
  jobId: string;
}

export interface ClassifierInput {
  id: string;
  title: string;
  description: string;
}

/** JD length that reliably contains responsibilities without blowing the batch. */
const JD_CHARS = 6000;

@Injectable()
export class JobClassifierService {
  private readonly logger = new Logger(JobClassifierService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}

  /**
   * Classify jobs in batches. A failed batch is skipped, never fatal — the same
   * containment that stops one malformed response from killing a 300-job run.
   */
  async classify(jobs: ClassifierInput[]): Promise<{ classified: ClassifiedJob[]; failedIds: string[] }> {
    const classified: ClassifiedJob[] = [];
    const failedIds: string[] = [];

    for (let i = 0; i < jobs.length; i += CLASSIFY_BATCH) {
      const batch = jobs.slice(i, i + CLASSIFY_BATCH);
      if (i > 0) await new Promise((r) => setTimeout(r, 6_000)); // RPM pacing

      try {
        const body = batch
          .map(
            (j) =>
              `--- jobId: ${j.id}\nTITLE: ${j.title}\nDESCRIPTION:\n${(j.description ?? '').slice(0, JD_CHARS)}`,
          )
          .join('\n\n');

        const res = await this.llm.generateJson<{ jobs: Partial<ClassifiedJob>[] }>(PROMPT + body, {
          system: SYSTEM,
          temperature: 0,
          maxOutputTokens: 8192,
        });

        for (const raw of res.jobs ?? []) {
          const normalized = this.normalize(raw);
          if (normalized) classified.push(normalized);
          else if (raw.jobId) failedIds.push(raw.jobId);
        }
      } catch (err) {
        failedIds.push(...batch.map((b) => b.id));
        this.logger.error(
          `classify batch ${i / CLASSIFY_BATCH + 1} failed, continuing: ${
            err instanceof Error ? err.message.slice(0, 180) : err
          }`,
        );
      }
    }

    return { classified, failedIds };
  }

  /** A model may invent an enum value; an unknown label must never be trusted. */
  private normalize(raw: Partial<ClassifiedJob>): ClassifiedJob | null {
    if (!raw.jobId) return null;

    const pf = PRIMARY_FUNCTIONS.includes(raw.primaryFunction as PrimaryFunction)
      ? (raw.primaryFunction as PrimaryFunction)
      : 'AMBIGUOUS';
    const rf = ROLE_FAMILIES.includes(raw.roleFamily as RoleFamily)
      ? (raw.roleFamily as RoleFamily)
      : 'AMBIGUOUS';
    const ci = CODING_INTENSITIES.includes(raw.codingIntensity as CodingIntensity)
      ? (raw.codingIntensity as CodingIntensity)
      : 'NONE';
    const sen = SENIORITIES.includes(raw.seniority as Seniority) ? (raw.seniority as Seniority) : 'UNKNOWN';

    const clampYears = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 30 ? Math.round(n) : null;

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];

    return {
      jobId: raw.jobId,
      primaryFunction: pf,
      roleFamily: rf,
      specialization: arr(raw.specialization),
      codingIntensity: ci,
      developmentConfidence: Math.max(0, Math.min(100, Math.round(Number(raw.developmentConfidence) || 0))),
      seniority: sen,
      minimumYears: clampYears(raw.minimumYears),
      maximumYears: clampYears(raw.maximumYears),
      requiredSkills: arr(raw.requiredSkills),
      preferredSkills: arr(raw.preferredSkills),
      responsibilities: arr(raw.responsibilities),
      developmentEvidence: arr(raw.developmentEvidence),
      nonDevelopmentEvidence: arr(raw.nonDevelopmentEvidence),
      classificationReason: typeof raw.classificationReason === 'string' ? raw.classificationReason : '',
    };
  }
}
