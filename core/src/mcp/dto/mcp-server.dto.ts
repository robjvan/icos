import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * MCP server management (S5). `name` comes from the path; `env` and
 * `headers` carry references (`$VAR`/`secret:NAME`), validated again on
 * write. No secret values pass through this DTO.
 */
export class McpServerDto {
  @IsIn(['stdio', 'http'])
  transport!: 'stdio' | 'http';

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  command?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['required', 'none'])
  approval?: 'required' | 'none';
}
