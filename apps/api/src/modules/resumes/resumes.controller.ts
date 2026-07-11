import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  MaxFileSizeValidator,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UploadResumeDto } from './dto/upload-resume.dto';
import type { ResumeProfile } from './resumes.service';
import { ResumesService } from './resumes.service';

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumesService: ResumesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.resumesService.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.resumesService.get(user.id, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_PDF_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadResumeDto,
  ) {
    return this.resumesService.upload(user.id, file, dto.resumeId, dto.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.resumesService.delete(user.id, id);
  }

  /** Re-run AI parsing on a version (e.g. after a parser improvement). */
  @Post('versions/:versionId/parse')
  @HttpCode(HttpStatus.ACCEPTED)
  reparse(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.resumesService.enqueueParse(user.id, versionId);
  }

  /** The parsed profile, for review before it is allowed to match jobs. */
  @Get('versions/:versionId/profile')
  profile(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.resumesService.profile(user.id, versionId);
  }

  /** Tailor the master resume to one job: company HTML + diff + 3 scores. */
  @Get('tailor/:jobId')
  tailor(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) {
    return this.resumesService.tailorResume(user.id, jobId);
  }

  /** Save corrections. Warns about skills absent from the resume, never blocks. */
  @Put('versions/:versionId/profile')
  saveProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() profile: ResumeProfile,
  ) {
    return this.resumesService.saveProfile(user.id, versionId, profile);
  }

  /**
   * Activate a reviewed version and re-evaluate every actionable job against
   * it. The only path that starts matching — parsing deliberately does not.
   */
  @Post('versions/:versionId/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.resumesService.activate(user.id, versionId);
  }

  /** Before/after score changes from the activation reconcile. */
  @Get('versions/:versionId/reconcile')
  reconcileReport(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.resumesService.reconcileReport(user.id, versionId);
  }

  /** Re-run reconciliation after a failure, without re-activating. */
  @Post('versions/:versionId/reconcile')
  @HttpCode(HttpStatus.ACCEPTED)
  retryReconcile(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.resumesService.retryReconcile(user.id, versionId);
  }
}
