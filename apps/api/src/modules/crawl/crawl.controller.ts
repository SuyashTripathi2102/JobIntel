import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  DISCOVERY_FANOUT_QUEUE,
  REFRESH_ALL_QUEUE,
  SEED_IMPORT_QUEUE,
} from './crawl.constants';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('crawl')
export class CrawlController {
  constructor(
    @InjectQueue(REFRESH_ALL_QUEUE) private readonly refreshQueue: Queue,
    @InjectQueue(SEED_IMPORT_QUEUE) private readonly seedQueue: Queue,
    @InjectQueue(DISCOVERY_FANOUT_QUEUE) private readonly discoveryQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /** Manual "refresh due companies now" — the 15-min schedule lives in workers. */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger() {
    const job = await this.refreshQueue.add('manual', { triggeredAt: new Date().toISOString() });
    return { enqueued: true, jobId: job.id };
  }

  /** Import a company directory (currently: YC). Discovery converts them after. */
  @Post('seed')
  @HttpCode(HttpStatus.ACCEPTED)
  async seed(@Body() body: { source?: string; limit?: number }) {
    const source = body?.source ?? 'yc';
    if (source !== 'yc') throw new BadRequestException(`Unknown seed source "${source}"`);
    const job = await this.seedQueue.add(
      'seed',
      { source, limit: body?.limit },
      { removeOnComplete: true, removeOnFail: true },
    );
    return { enqueued: true, jobId: job.id };
  }

  /** Manual "probe due companies now" — the 10-min schedule lives in workers. */
  @Post('discover')
  @HttpCode(HttpStatus.ACCEPTED)
  async discover() {
    const job = await this.discoveryQueue.add('manual', {
      triggeredAt: new Date().toISOString(),
    });
    return { enqueued: true, jobId: job.id };
  }

  /** Recent crawl activity — feeds the future admin panel. */
  @Get('runs')
  runs() {
    return this.prisma.crawlRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { company: { select: { id: true, name: true } } },
    });
  }
}
