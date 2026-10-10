import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CANDIDATE_SORTS } from '../../memory/memory-candidate.repository';
import type { CandidateSort } from '../../memory/memory-candidate.repository';
import type { MemoryCandidate } from '../../memory/memory-candidate';

export class ListCandidatesQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Ledger ordering (M20g). Defaults to insertion order (`recent`). */
  @IsOptional()
  @IsIn(CANDIDATE_SORTS)
  sort?: CandidateSort;
}

export class ListCandidatesResponseDto {
  candidates!: MemoryCandidate[];
}
