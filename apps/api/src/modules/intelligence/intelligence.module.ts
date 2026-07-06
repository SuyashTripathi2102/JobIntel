import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntelligenceController } from './intelligence.controller';
import { DERIVE_INTEL_QUEUE, IntelligenceProcessor } from './intelligence.processor';
import { IntelligenceService } from './intelligence.service';

@Module({
  imports: [BullModule.registerQueue({ name: DERIVE_INTEL_QUEUE })],
  controllers: [IntelligenceController],
  providers: [IntelligenceService, IntelligenceProcessor],
})
export class IntelligenceModule {}
