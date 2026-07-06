import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResumesController } from './resumes.controller';
import { ResumesRepository } from './resumes.repository';
import { ResumesService } from './resumes.service';
import { ResumeIntelligenceService } from './resume-intelligence.service';
import { PARSE_RESUME_QUEUE, ResumesProcessor } from './resumes.processor';

@Module({
  imports: [BullModule.registerQueue({ name: PARSE_RESUME_QUEUE })],
  controllers: [ResumesController],
  providers: [ResumesService, ResumesRepository, ResumeIntelligenceService, ResumesProcessor],
})
export class ResumesModule {}
