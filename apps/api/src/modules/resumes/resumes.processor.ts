import { Processor, WorkerHost } from '@nestjs/bullmq';
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

  async process(job: Job<{ resumeVersionId: string }>) {
    this.logger.log(`Parsing resume version ${job.data.resumeVersionId}...`);
    const parsed = await this.intelligence.parseVersion(job.data.resumeVersionId);
    this.logger.log(
      `Parsed: ${parsed.fullName ?? 'unknown'} — ${parsed.skills.length} skills, ${parsed.experience.length} roles`,
    );
    return { skills: parsed.skills.length };
  }
}
