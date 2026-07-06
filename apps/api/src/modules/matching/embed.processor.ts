import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { EMBED_JOBS_QUEUE } from '../internal/internal.constants';
import { MATCH_NEW_JOBS_QUEUE } from './matching.constants';
import { MatchingService } from './matching.service';

/** Embeds newly ingested jobs, then hands them to the incremental matcher —
 *  the embed→match→score→notify chain that makes "never miss an opportunity"
 *  a latency number instead of a slogan. */
@Processor(EMBED_JOBS_QUEUE)
export class EmbedProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProcessor.name);

  constructor(
    private readonly matching: MatchingService,
    @InjectQueue(MATCH_NEW_JOBS_QUEUE) private readonly matchQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ jobIds: string[] }>) {
    const embedded = await this.matching.embedJobsByIds(job.data.jobIds);
    if (embedded > 0) {
      this.logger.log(`Embedded ${embedded} new job(s) at ingest`);
      await this.matchQueue.add(
        'match',
        { jobIds: job.data.jobIds },
        {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
    }
    return { embedded };
  }
}
