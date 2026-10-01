import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Select the active provider for one role (S4/S5). */
export class SetActiveProviderDto {
  @IsIn(['conversation', 'memory'])
  role!: 'conversation' | 'memory';

  @IsString()
  @MaxLength(64)
  id!: string;
}

/**
 * LLM provider management (S5). `id` comes from the path. `apiKeyRef`
 * and header values are references (`$VAR`/`secret:NAME`), validated
 * again on write — no secret value passes through this DTO.
 */
export class ProviderDto {
  @IsString()
  @MaxLength(2048)
  baseUrl!: string;

  @IsString()
  @MaxLength(256)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  apiKeyRef?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  userAgent?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3_600_000)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
