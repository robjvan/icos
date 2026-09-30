import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { ProspectiveItem } from '../../memory/prospective-item';

export class ListProspectiveQueryDto {
  @IsOptional()
  @IsIn(['open', 'dismissed'])
  status?: 'open' | 'dismissed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListProspectiveResponseDto {
  items!: ProspectiveItem[];
}
