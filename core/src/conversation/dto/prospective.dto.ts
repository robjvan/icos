import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

export class ResolveProspectiveDto {
  /** Closing outcome: standing affirmed, revision noted, or ignored. */
  @IsIn(['confirmed', 'corrected', 'dismissed'])
  outcome!: 'confirmed' | 'corrected' | 'dismissed';

  /** Free-form context recorded on every involved claim's history. */
  @IsOptional()
  @IsString()
  note?: string;
}

export class ResolveProspectiveResponseDto {
  item!: ProspectiveItem;
}
