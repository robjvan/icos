import { Controller, Get, Query } from '@nestjs/common';
import { ProspectiveItemRepository } from '../memory/prospective-item.repository';
import {
  ListProspectiveQueryDto,
  ListProspectiveResponseDto,
} from './dto/prospective.dto';

/**
 * Inspection API for the clarification queue. Read-only: rows are
 * parked by promotion on contradiction (M10e triggers) and surfaced
 * upstream by later work — nothing here mutates, retries, or nags.
 */
@Controller('core/prospective')
export class ProspectiveController {
  constructor(private readonly prospective: ProspectiveItemRepository) {}

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
}
