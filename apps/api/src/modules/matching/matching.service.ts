import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER } from '../ai/llm.provider';
import type { LlmProvider } from '../ai/llm.provider';
import type { ParsedResume } from '../resumes/resume-intelligence.service';

const SIMILARITY_TOP_K = 40; // pgvector prefilter size
const LLM_SCORE_TOP_N = 15; // how many get deep LLM scoring
const SCORE_BATCH = 5; // jobs per LLM call (free-tier RPM friendly)

interface JobScore {
  jobId: string;
  overallScore: number;
  technicalScore: number;
  experienceScore: number;
  missingSkills: string[];
  reasoning: string;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Stage 0: ensure every ACTIVE job has an embedding (batched backfill).
   * Stage 1: pgvector cosine similarity — cheap prefilter over ALL jobs.
   * Stage 2: LLM deep-scores the top candidates against the parsed resume.
   */
  async generateForUser(userId: string): Promise<{ matched: number; scanned: number }> {
    const resume = await this.getPrimaryResumeContext(userId);

    // Backfill is best-effort: chunks persist as they finish, so if quota
    // runs dry we score with what's embedded and complete coverage next run.
    try {
      const embedded = await this.backfillJobEmbeddings();
      if (embedded > 0) this.logger.log(`Backfilled ${embedded} job embeddings`);
    } catch (err) {
      this.logger.warn(
        `Embedding backfill stopped early (${err instanceof Error ? err.message.slice(0, 120) : err}) — matching with existing embeddings`,
      );
    }

    const candidates = await this.similarJobs(resume.resumeVersionId, SIMILARITY_TOP_K);
    this.logger.log(`Prefilter: ${candidates.length} candidates by cosine similarity`);

    const toScore = candidates.slice(0, LLM_SCORE_TOP_N);
    let matched = 0;
    for (let i = 0; i < toScore.length; i += SCORE_BATCH) {
      if (i > 0) await new Promise((r) => setTimeout(r, 8_000)); // free-tier RPM pacing
      const batch = toScore.slice(i, i + SCORE_BATCH);
      const scores = await this.scoreBatch(resume.parsed, batch);
      for (const s of scores) {
        await this.prisma.jobMatch.upsert({
          where: { userId_jobId: { userId, jobId: s.jobId } },
          create: {
            userId,
            jobId: s.jobId,
            resumeVersionId: resume.resumeVersionId,
            overallScore: s.overallScore,
            technicalScore: s.technicalScore,
            experienceScore: s.experienceScore,
            missingSkills: s.missingSkills,
            reasoning: s.reasoning,
          },
          update: {
            resumeVersionId: resume.resumeVersionId,
            overallScore: s.overallScore,
            technicalScore: s.technicalScore,
            experienceScore: s.experienceScore,
            missingSkills: s.missingSkills,
            reasoning: s.reasoning,
          },
        });
        matched++;
      }
    }

    return { matched, scanned: candidates.length };
  }

  list(userId: string, minScore = 0) {
    return this.prisma.jobMatch.findMany({
      where: { userId, overallScore: { gte: minScore }, job: { status: 'ACTIVE' } },
      orderBy: { overallScore: 'desc' },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            url: true,
            location: true,
            workMode: true,
            salaryMin: true,
            salaryMax: true,
            currency: true,
            postedAt: true,
            company: { select: { id: true, name: true, website: true } },
          },
        },
      },
    });
  }

  private async getPrimaryResumeContext(userId: string) {
    const version = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true } },
      orderBy: { versionNumber: 'desc' },
      include: { embedding: { select: { id: true } } },
    });
    if (!version) {
      throw new BadRequestException('Upload a resume first (and mark one primary)');
    }
    const structured = (version.parsedJson as { structured?: ParsedResume } | null)?.structured;
    if (!structured || !version.embedding) {
      throw new BadRequestException(
        'Primary resume is not parsed yet — run POST /resumes/versions/:id/parse first',
      );
    }
    return { resumeVersionId: version.id, parsed: structured };
  }

  /**
   * Embed ACTIVE jobs that don't have vectors yet, persisting after every
   * chunk — a crash or rate-limit failure mid-backfill loses at most one
   * chunk, and the next run resumes where this one stopped.
   */
  private async backfillJobEmbeddings(): Promise<number> {
    const missing = await this.prisma.job.findMany({
      where: { status: 'ACTIVE', embedding: null },
      select: { id: true, title: true, description: true, location: true },
    });
    if (missing.length === 0) return 0;

    const CHUNK = 20;
    let done = 0;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      // ~2k chars ≈ 500 tokens — similarity semantics live in the head of
      // the description, and small texts keep free-tier token limits happy.
      const texts = chunk.map((j) =>
        `${j.title}\n${j.location ?? ''}\n${j.description.slice(0, 2_000)}`.trim(),
      );
      const vectors = await this.llm.embed(texts);

      for (let k = 0; k < chunk.length; k++) {
        const literal = `[${vectors[k].join(',')}]`;
        await this.prisma.$executeRaw`
          INSERT INTO job_embeddings (id, "jobId", model, vector, "createdAt")
          VALUES (${randomUUID()}, ${chunk[k].id}, 'gemini-embedding-2', ${literal}::vector, now())
          ON CONFLICT ("jobId") DO NOTHING
        `;
      }
      done += chunk.length;
      if (done % 200 === 0 || done === missing.length) {
        this.logger.log(`Embedding backfill: ${done}/${missing.length}`);
      }
    }
    return missing.length;
  }

  private async similarJobs(
    resumeVersionId: string,
    limit: number,
  ): Promise<{ id: string; title: string; description: string; similarity: number }[]> {
    return this.prisma.$queryRaw`
      SELECT j.id, j.title, j.description,
             1 - (je.vector <=> re.vector) AS similarity
      FROM job_embeddings je
      JOIN jobs j ON j.id = je."jobId" AND j.status = 'ACTIVE'
      CROSS JOIN (SELECT vector FROM resume_embeddings WHERE "resumeVersionId" = ${resumeVersionId}) re
      ORDER BY je.vector <=> re.vector
      LIMIT ${limit}
    `;
  }

  private async scoreBatch(
    resume: ParsedResume,
    jobs: { id: string; title: string; description: string }[],
  ): Promise<JobScore[]> {
    const prompt = `You are scoring how well ONE candidate fits each job below.

CANDIDATE:
${resume.summaryForMatching}
Skills: ${resume.skills.map((s) => s.name).join(', ')}
Total experience: ${resume.totalYearsExperience ?? 'unknown'} years

JOBS:
${jobs
  .map(
    (j, i) => `--- JOB ${i + 1} (id: ${j.id}) ---
${j.title}
${j.description.slice(0, 4_000)}`,
  )
  .join('\n\n')}

For EACH job return: overallScore, technicalScore, experienceScore (0-100 integers, be honest —
seniority mismatches and missing core requirements should hurt the score), missingSkills
(candidate lacks but job needs, lowercase), reasoning (2-3 frank sentences: why this fits or
doesn't, addressed to the candidate as "you").

Return JSON: {"scores":[{"jobId":string,"overallScore":number,"technicalScore":number,"experienceScore":number,"missingSkills":[string],"reasoning":string}]}`;

    const res = await this.llm.generateJson<{ scores: JobScore[] }>(prompt);
    const valid = new Set(jobs.map((j) => j.id));
    return (res.scores ?? []).filter((s) => valid.has(s.jobId));
  }
}
