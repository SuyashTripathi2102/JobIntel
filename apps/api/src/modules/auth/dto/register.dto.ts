import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt truncates beyond 72 bytes — reject instead of silently truncating
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
