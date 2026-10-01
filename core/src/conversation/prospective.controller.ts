import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ClaimHistoryRepository } from '../memory/claim-history.repository';
import { ClaimRepository } from '../memory/claim.repository';
import { ProspectiveItemRepository } from '../memory/prospective-item.repository';
import {
  ListProspectiveQueryDto,
  ListProspectiveResponseDto,
  ResolveProspectiveDto,
  ResolveProspectiveResponseDto,
} from './dto/prospective.dto';

/**
 * Inspection + completion API for the clarification queue. Rows are
 * parked by promotion on contradiction (M10e triggers); closing is
 * an explicit human act (M12c) recording confirmed / corrected /
 * dismissed with history on every involved claim. Nothing retries,
 * nothing nags, and closing never edits a belief.
 */
@Controller('core/prospective')
export class ProspectiveController {
  constructor(
    private readonly prospective: ProspectiveItemRepository,
    private readonly claims: ClaimRepository,
    private readonly history: ClaimHistoryRepository,
  ) {}

  @Get()
  async list(
    @Query() query: ListProspectiveQueryDto,
  ): Promise<ListProspectiveResponseDto> {
    return {
      items: await this.prospective.listItems({
        // Open questions are the default view; dismissed rows stay
        // queryable so nothing silently disappears.
        status: query.status ?? 'open',
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    };
  }

  /**
   * Close an open question with a recorded outcome. A correction is
   * noted with full provenance (`note` + claim history) — the
   * belief update itself, if any, travels the normal promotion
   * path later, never this endpoint.
   */
  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id') id: string,
    @Body() body: ResolveProspectiveDto,
  ): Promise<ResolveProspectiveResponseDto> {
    const item = await this.prospective.getItem(id);
    if (!item) throw new NotFoundException(`Unknown prospective item "${id}"`);
    if (item.status !== 'open') {
      throw new BadRequestException(
        `Prospective item "${id}" is already ${item.status}`,
      );
    }
    const resolved = await this.prospective.resolve(id, body.outcome);
    if (!resolved)
      throw new NotFoundException(`Unknown prospective item "${id}"`);
    for (const option of resolved.options) {
      const claim = await this.claims.getClaim(option.claimId);
      if (!claim) continue;
      await this.history.record({
        claimId: claim.id,
        transition: 'revise',
        detail: {
          prospective: id,
          outcome: body.outcome,
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
        confidenceBefore: claim.confidence,
        confidenceAfter: claim.confidence,
      });
    }
    return { item: resolved };
  }
}
