import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { DailyBriefService } from './daily-brief.service';

/** Worker-facing trigger — the workers' 8AM IST cron calls this. */
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/daily-brief')
export class DailyBriefInternalController {
  constructor(private readonly brief: DailyBriefService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  send() {
    return this.brief.sendAll();
  }

  @Post('consider-digest')
  @HttpCode(HttpStatus.OK)
  considerDigest() {
    return this.brief.sendConsiderDigest();
  }
}
