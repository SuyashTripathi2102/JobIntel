import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';

export const GENERATE_MATCHES_QUEUE = 'generate-matches';

@Processor(GENERATE_MATCHES_QUEUE)
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(private readonly matching: MatchingService) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`generate-matches ${job?.id ?? '?'} failed: ${err.message}`, err.stack);
  }

  async process(job: Job<{ userId: string }>) {
    this.logger.log(`Generating matches for user ${job.data.userId}...`);
    const result = await this.matching.generateForUser(job.data.userId);
    this.logger.log(`Done: ${result.matched} matches from ${result.scanned} candidates`);
    return result;
  }
}
