import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadResumeDto {
  /** Omit to create a new resume; provide to add a version to an existing one. */
  @IsOptional()
  @IsString()
  resumeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
