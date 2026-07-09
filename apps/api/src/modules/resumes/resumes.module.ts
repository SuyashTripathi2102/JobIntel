import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MatchingModule } from '../matching/matching.module';
import { ResumesController } from './resumes.controller';
import { ResumesRepository } from './resumes.repository';
import { ResumesService } from './resumes.service';
import { ResumeIntelligenceService } from './resume-intelligence.service';
import { PARSE_RESUME_QUEUE, ResumesProcessor } from './resumes.processor';

@Module({
  // forwardRef: MatchingModule → NotificationsModule → (back here) is circular.
  imports: [
    BullModule.registerQueue({ name: PARSE_RESUME_QUEUE }),
    forwardRef(() => MatchingModule),
  ],
  controllers: [ResumesController],
  providers: [ResumesService, ResumesRepository, ResumeIntelligenceService, ResumesProcessor],
})
export class ResumesModule {}
