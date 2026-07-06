import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CompanyCandidateSchema, DiscoveryResultSchema } from '@careeros/shared';
import { Public } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { DiscoveryService } from './discovery.service';

const BulkBodySchema = z.object({
  source: z.string().min(1),
  candidates: z.array(CompanyCandidateSchema).max(5000),
});

/** Internal (worker-facing) endpoints of the Company Discovery Engine. */
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/discovery')
export class DiscoveryInternalController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('bulk')
  bulk(@Body() body: unknown) {
    const parsed = BulkBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.discovery.bulkDiscover(parsed.data.source, parsed.data.candidates);
  }

  @Get('due')
  due(@Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number) {
    return this.discovery.probeDue(Math.min(limit, 100));
  }

  @Post(':companyId/result')
  result(@Param('companyId') companyId: string, @Body() body: unknown) {
    const parsed = DiscoveryResultSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.discovery.applyResult(companyId, parsed.data);
  }
}

/** User-facing: the conversion funnel — Phase B's success metric. */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('stats')
  stats() {
    return this.discovery.funnelStats();
  }
}
