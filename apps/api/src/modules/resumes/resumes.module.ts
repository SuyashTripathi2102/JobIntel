import { Module } from '@nestjs/common';
import { ResumesController } from './resumes.controller';
import { ResumesRepository } from './resumes.repository';
import { ResumesService } from './resumes.service';

@Module({
  controllers: [ResumesController],
  providers: [ResumesService, ResumesRepository],
})
export class ResumesModule {}
