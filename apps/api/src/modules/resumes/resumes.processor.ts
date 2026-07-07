import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ResumeIntelligenceService } from './resume-intelligence.service';

export const PARSE_RESUME_QUEUE = 'parse-resume';

@Processor(PARSE_RESUME_QUEUE)
export class ResumesProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumesProcessor.name);

  constructor(private readonly intelligence: ResumeIntelligenceService) {
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
    return { skills: parsed.skills.length };
  }
}
