import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Bootstrap-token login (S2). */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
