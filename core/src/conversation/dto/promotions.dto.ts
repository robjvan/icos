import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type {
  JournalState,
  PromotionJournalEntry,
  SweepSummary,
} from '../../memory/promotion';
import { JOURNAL_STATES } from '../../memory/promotion';

export class RunPromotionsResponseDto {
  summary!: SweepSummary;
}

export type PendingPromotion = PromotionJournalEntry & {
  approvalStatus: string | null;
};

export class ListPendingPromotionsResponseDto {
  pending!: PendingPromotion[];
}

export class ListPromotionsQueryDto {
  /**
   * Journal states to include. Repeatable (`?state=proposed&state=denied`)
   * or CSV (`?state=proposed,denied`). Empty/absent means all states.
   * Unknown states are rejected (400), never silently dropped.
   */
  @IsOptional()
  @IsArray()
  @IsIn([...JOURNAL_STATES], { each: true })
  @Transform(({ value }: { value: unknown }): unknown => {
    const raw = Array.isArray(value) ? value : [value];
    const states: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') return item;
      for (const part of item.split(',')) {
        const trimmed = part.trim();
        if (trimmed) states.push(trimmed);
      }
    }
    return states;
  })
  state?: JournalState[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListPromotionsResponseDto {
  promotions!: PendingPromotion[];

  /** Total rows matching the state filter, before the limit. */
  total!: number;
}
