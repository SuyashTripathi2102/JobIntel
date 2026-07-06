import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { GENERATE_MATCHES_QUEUE } from './matching.processor';
import { MatchingService } from './matching.service';

@Controller('matches')
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    @InjectQueue(GENERATE_MATCHES_QUEUE) private readonly queue: Queue,
  ) {}

  /** Async — embedding backfill + LLM scoring can take minutes on free tier. */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@CurrentUser() user: AuthenticatedUser) {
    const job = await this.queue.add(
      'user',
      { userId: user.id },
      {
        jobId: `match-${user.id}`,
        // Whole-job retries are cheap: embedding backfill persists per chunk,
        // so a retry resumes where the failed run stopped.
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return { enqueued: true, jobId: job.id };
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('minScore', new DefaultValuePipe(0), ParseIntPipe) minScore: number,
  ) {
    return this.matching.list(user.id, minScore);
  }

  /** Recompute opportunity scores (no LLM) + run the notification gate. */
  @Post('rescore')
  rescore(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.rescoreExisting(user.id);
  }
}
