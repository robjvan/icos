import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { JOURNAL_STATES } from '../memory/promotion';
import type { JournalState } from '../memory/promotion';
import { PromotionService } from '../memory/promotion.service';
import {
  ListPendingPromotionsResponseDto,
  ListPromotionsQueryDto,
  ListPromotionsResponseDto,
  RunPromotionsResponseDto,
} from './dto/promotions.dto';

/**
 * Explicit promotion driver. Approving a `memory.promote` request
 * records authority; this endpoint executes it — the same pull
 * pattern as tool-approval resume. Manual trigger, post-approval
 * driver, and crash-recovery path in one idempotent sweep.
 */
@Controller('core/promotions')
export class PromotionsController {
  constructor(private readonly promotion: PromotionService) {}

  @Post('run')
  @HttpCode(200)
  async run(): Promise<RunPromotionsResponseDto> {
    return { summary: await this.promotion.sweep() };
  }

  /**
   * Bulk approve/reject every open promotion (M20j). Approve runs a single
   * sweep afterwards. Returns per-item applied/failed counts.
   */
  @Post('bulk')
  @HttpCode(200)
  async bulk(@Body() dto: { decision?: 'approve' | 'reject' }) {
    if (dto?.decision !== 'approve' && dto?.decision !== 'reject') {
      throw new BadRequestException('decision must be "approve" or "reject"');
    }
    return this.promotion.bulkResolve(dto.decision);
  }

  @Get('pending')
  async pending(): Promise<ListPendingPromotionsResponseDto> {
    return { pending: await this.promotion.listPending() };
  }

  /**
   * Full journal listing, including terminal rows. Additive alongside
   * `/pending` (which stays byte-identical for existing consumers):
   * `?state=` filters (repeatable or CSV, default all states),
   * `?limit=` bounds the page (default 50, max 200). Rows are in
   * journal order; `total` is the pre-limit count.
   */
  @Get()
  async list(
    @Query() query: ListPromotionsQueryDto,
  ): Promise<ListPromotionsResponseDto> {
    const states: JournalState[] = query.state ?? [...JOURNAL_STATES];
    const { promotions, total } = await this.promotion.listByStates(
      states,
      query.limit ?? 50,
    );
    return { promotions, total };
  }
}
