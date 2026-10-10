import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
} from '@nestjs/common';
import { ContextBudgetService } from './context-budget.service';
import { ContextCompactionService } from './context-compaction.service';
import { RequireRole } from '../auth/decorators';

/**
 * Context budget + compaction surface (M20.6.3). Read is open to any
 * authenticated caller; changing the target/enabled is admin-only. The
 * per-session summary is the inspectable compaction result.
 */
@Controller('core/context')
export class ContextController {
  constructor(
    private readonly budget: ContextBudgetService,
    private readonly compaction: ContextCompactionService,
  ) {}

  @Get()
  settings(): { settings: ReturnType<ContextBudgetService['settings']> } {
    return { settings: this.budget.settings() };
  }

  @RequireRole('admin')
  @Put()
  update(@Body() dto: { target?: number; enabled?: boolean }): {
    settings: ReturnType<ContextBudgetService['settings']>;
  } {
    if (dto?.target !== undefined) {
      if (typeof dto.target !== 'number' || !Number.isFinite(dto.target)) {
        throw new BadRequestException('target must be a number');
      }
      this.budget.setTarget(dto.target);
    }
    if (dto?.enabled !== undefined) {
      this.budget.setEnabled(dto.enabled === true);
    }
    return { settings: this.budget.settings() };
  }

  @Get('summary')
  async summary(@Query('sessionId') sessionId?: string): Promise<{
    sessionId: string;
    summary: unknown;
    settings: ReturnType<ContextBudgetService['settings']>;
  }> {
    if (!sessionId?.trim()) {
      throw new BadRequestException(
        'Usage: /core/context/summary?sessionId=<id>',
      );
    }
    return {
      sessionId,
      summary: await this.compaction.summaryFor(sessionId),
      settings: this.budget.settings(),
    };
  }
}
