import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { GENERATE_MATCHES_QUEUE } from './matching.processor';
import { MatchingService } from './matching.service';

/** System-driven catch-up: called after a resume re-parse and on a schedule. */
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/matches')
export class MatchingInternalController {
  constructor(private readonly matching: MatchingService) {}

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  reconcileAll() {
    return this.matching.reconcileAll();
  }

  /**
   * Recompute opportunity score + canonical verdict for every existing match.
   * No LLM: the resume scores are already stored. Used after a decision-logic
   * change, so no match is left with a stale or missing verdict.
   */
  @Post('rescore')
  @HttpCode(HttpStatus.OK)
  rescoreAll() {
    return this.matching.rescoreAllUsers();
  }
}

@Controller('matches')
export class MatchingController {
  private readonly minScore: number;

  constructor(
    private readonly matching: MatchingService,
    @InjectQueue(GENERATE_MATCHES_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.minScore = Number(config.get('NOTIFY_MIN_SCORE', 70));
  }

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

  /** Score existing India jobs that were never matched (LLM) — the catch-up. */
  @Post('reconcile')
  @HttpCode(HttpStatus.ACCEPTED)
  reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.reconcileForUser(user.id);
  }

  /** "Why didn't I get notified about this job?" — explain the decision path. */
  @Get('why/:jobId')
  why(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) {
    return this.matching.explainNotification(user.id, jobId, this.minScore);
  }
}
