import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MATCH_NEW_JOBS_QUEUE } from './matching.constants';
import { MatchingService } from './matching.service';

@Processor(MATCH_NEW_JOBS_QUEUE)
export class MatchNewJobsProcessor extends WorkerHost {
  constructor(private readonly matching: MatchingService) {
    super();
  }

  async process(job: Job<{ jobIds: string[] }>) {
    return this.matching.matchNewJobs(job.data.jobIds);
  }
}
