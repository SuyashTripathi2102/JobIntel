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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UploadResumeDto } from './dto/upload-resume.dto';
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
}
