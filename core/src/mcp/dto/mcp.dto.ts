import { IsObject, IsOptional } from 'class-validator';

/** Optional named arguments for a prompt template fetch (M13e). */
export class GetPromptDto {
  @IsOptional()
  @IsObject()
  arguments?: Record<string, string>;
}
