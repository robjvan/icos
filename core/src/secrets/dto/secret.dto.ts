import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Write-only secret value (S3). Never echoed back by the API. */
export class PutSecretDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(65536)
  value!: string;
}
