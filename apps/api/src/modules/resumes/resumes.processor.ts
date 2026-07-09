import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { ResumeIntelligenceService } from './resume-intelligence.service';

export const PARSE_RESUME_QUEUE = 'parse-resume';

/** Re-scoring the full actionable backlog against a new resume version. */
const ACTIVATION_RECONCILE_CAP = 400;

type ParseJob = { resumeVersionId: string };
type ReconcileJob = { resumeVersionId: string; userId: string };

@Processor(PARSE_RESUME_QUEUE)
export class ResumesProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumesProcessor.name);

  constructor(
    private readonly intelligence: ResumeIntelligenceService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MatchingService)) private readonly matching: MatchingService,
  ) {
    super();
  }

  // BullMQ failures are invisible without this (2026-07-08: a parse died
  // silently mid-migration — no log, job removed, nothing to debug from).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`${job?.name ?? '?'} ${job?.id ?? '?'} failed: ${err.message}`, err.stack);
  }

  async process(job: Job<ParseJob | ReconcileJob>) {
    if (job.name === 'reconcile') return this.reconcile(job.data as ReconcileJob);
    return this.parse(job.data as ParseJob);
  }

  private async parse({ resumeVersionId }: ParseJob) {
    this.logger.log(`Parsing resume version ${resumeVersionId}...`);
    const parsed = await this.intelligence.parseVersion(resumeVersionId);
    this.logger.log(
      `Parsed: ${parsed.fullName ?? 'unknown'} — ${parsed.skills.length} skills, ${parsed.experience.length} roles`,
    );

    // Parsing does NOT activate the resume and does NOT reconcile. The user
    // reviews the extracted profile first — every skill CareerOS believed in
    // before 2026-07-09 came from a vision read of a PDF whose text layer was
    // unreadable, and nobody had ever checked it. Activation is explicit.
    return { skills: parsed.skills.length };
  }

  private async reconcile({ resumeVersionId, userId }: ReconcileJob) {
    this.logger.log(`Reconciling actionable jobs against resume ${resumeVersionId}...`);
    const report = await this.matching.reconcileForUser(userId, ACTIVATION_RECONCILE_CAP);

    await this.prisma.resumeVersion.update({
      where: { id: resumeVersionId },
      data: {
        reconciledAt: new Date(),
        reconcileReport: report as unknown as Prisma.InputJsonValue,
      },
    });
    return report;
  }
}
