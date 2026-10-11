import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalService } from './approval.service';
import type { DelegationContext } from '../subagents/delegation.repository';
import { DelegationRepository } from '../subagents/delegation.repository';
import {
  CreateApprovalDto,
  ListApprovalsQueryDto,
  ResolveApprovalDto,
} from './dto/approvals.dto';

/**
 * Explicit human-approval API. Every mutation requires the owning
 * `sessionId` in the body — an LLM response can never satisfy that, so
 * assistant text is structurally incapable of approving anything.
 */
@Controller('core/approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly delegations: DelegationRepository,
  ) {}

  /**
   * Attach delegation context to approvals arising from a child session
   * (M21.2) — the queue shows *why* the approval exists. Fail-soft per
   * item: tagging never breaks the queue.
   */
  private async tagged<T extends { sessionId: string }>(
    items: readonly T[],
  ): Promise<(T & { delegation?: DelegationContext })[]> {
    return Promise.all(
      items.map(async (item) => {
        try {
          const delegation = await this.delegations.contextForChild(
            item.sessionId,
          );
          return delegation ? { ...item, delegation } : item;
        } catch {
          return item;
        }
      }),
    );
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateApprovalDto) {
    return this.approvals.create({
      sessionId: dto.sessionId,
      action: dto.action,
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.ttlMs !== undefined ? { ttlMs: dto.ttlMs } : {}),
    });
  }

  @Get()
  async list(@Query() query: ListApprovalsQueryDto) {
    const approvals = await this.approvals.list({
      ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    return { approvals: await this.tagged(approvals) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const [tagged] = await this.tagged([await this.approvals.get(id)]);
    return tagged;
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.approve(id, dto.sessionId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.reject(id, dto.sessionId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.cancel(id, dto.sessionId);
  }
}
