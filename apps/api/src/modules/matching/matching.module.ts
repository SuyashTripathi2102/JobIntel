import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MatchingController } from './matching.controller';
import { GENERATE_MATCHES_QUEUE, MatchingProcessor } from './matching.processor';
import { MatchingService } from './matching.service';

@Module({
  imports: [BullModule.registerQueue({ name: GENERATE_MATCHES_QUEUE })],
  controllers: [MatchingController],
  providers: [MatchingService, MatchingProcessor],
})
export class MatchingModule {}
