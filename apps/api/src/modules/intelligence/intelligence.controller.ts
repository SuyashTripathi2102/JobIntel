import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DERIVE_INTEL_QUEUE } from './intelligence.processor';
import { IntelligenceService } from './intelligence.service';

@Controller()
export class IntelligenceController {
  constructor(
    private readonly intel: IntelligenceService,
    @InjectQueue(DERIVE_INTEL_QUEUE) private readonly queue: Queue,
  ) {}

  @Get('companies/:id/intelligence')
  get(@Param('id') id: string) {
    return this.intel.get(id);
  }

  /** Kick off derivation for companies with stale/missing profiles. */
  @Post('intelligence/derive')
  @HttpCode(HttpStatus.ACCEPTED)
  async derive() {
    const job = await this.queue.add(
      'derive',
      {},
      { removeOnComplete: true, removeOnFail: true },
    );
    return { enqueued: true, jobId: job.id };
  }
}
