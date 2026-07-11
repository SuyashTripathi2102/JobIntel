import { Module } from '@nestjs/common';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

/** PrismaService is global; the orchestrator reads across pillars read-only. */
@Module({
  controllers: [TodayController],
  providers: [TodayService],
})
export class TodayModule {}
