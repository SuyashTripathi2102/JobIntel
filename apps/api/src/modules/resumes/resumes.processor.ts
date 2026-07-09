import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { ResumeIntelligenceService } from './resume-intelligence.service';

export const PARSE_RESUME_QUEUE = 'parse-resume';

@Processor(PARSE_RESUME_QUEUE)
export class ResumesProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumesProcessor.name);

  constructor(
    private readonly intelligence: ResumeIntelligenceService,
    private readonly matching: MatchingService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  // BullMQ failures are invisible without this (2026-07-08: a parse died
  // silently mid-migration — no log, job removed, nothing to debug from).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`parse-resume ${job?.id ?? '?'} failed: ${err.message}`, err.stack);
  }

  async process(job: Job<{ resumeVersionId: string }>) {
    this.logger.log(`Parsing resume version ${job.data.resumeVersionId}...`);
    const parsed = await this.intelligence.parseVersion(job.data.resumeVersionId);
    this.logger.log(
      `Parsed: ${parsed.fullName ?? 'unknown'} — ${parsed.skills.length} skills, ${parsed.experience.length} roles`,
    );

    // ARCHITECTURAL GUARANTEE (2026-07-09): a new/re-parsed resume invalidates
    // every existing score. Without this, jobs matched under the old resume keep
    // stale verdicts forever — the exact gap that left 111 India jobs unscored.
    // Reconcile evaluates actionable, in-country jobs against the new resume.
    const version = await this.prisma.resumeVersion.findUnique({
      where: { id: job.data.resumeVersionId },
      select: { resume: { select: { userId: true } } },
    });
    const userId = version?.resume.userId;
    if (userId) {
      try {
        const r = await this.matching.reconcileForUser(userId);
        this.logger.log(
          `Post-parse reconcile: ${r.scored} scored (${r.apply} APPLY, ${r.consider} CONSIDER)`,
        );
      } catch (err) {
        // Never fail the parse because the catch-up failed — it retries on schedule.
        this.logger.error(
          `post-parse reconcile failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { skills: parsed.skills.length };
  }
}
