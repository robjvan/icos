import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Post,
  Body,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Claim } from '../memory/claim';
import {
  ClaimIndex,
  ClaimIndexUnavailableError,
  type SimilarClaim,
} from '../memory/claim-index';
import { ClaimHistoryRepository } from '../memory/claim-history.repository';
import { ClaimRepository } from '../memory/claim.repository';
import {
  MaintenanceService,
  RetirementIneligibleError,
} from '../memory/maintenance.service';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { PromotionJournalRepository } from '../memory/promotion-journal.repository';
import {
  ClaimDetailResponseDto,
  ListClaimsQueryDto,
  ListClaimsResponseDto,
  RetireClaimDto,
  RetireClaimResponseDto,
  SearchClaimsQueryDto,
  SearchClaimsResponseDto,
  TimelineClaimsQueryDto,
  TimelineClaimsResponseDto,
} from './dto/claims.dto';

/**
 * Inspection API for the belief store. Read-only in every direction:
 * claims are born through promotion (M10c) and age through dynamics
 * (M12) — nothing here mutates. Debug/observation surface.
 */
@Controller('core/claims')
export class ClaimsController {
  constructor(
    private readonly claims: ClaimRepository,
    private readonly candidates: MemoryCandidateRepository,
    private readonly journal: PromotionJournalRepository,
    private readonly index: ClaimIndex,
    private readonly history: ClaimHistoryRepository,
    private readonly maintenance: MaintenanceService,
  ) {}

  @Get()
  async list(
    @Query() query: ListClaimsQueryDto,
  ): Promise<ListClaimsResponseDto> {
    return {
      claims: await this.claims.listClaims({
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.category !== undefined ? { category: query.category } : {}),
        ...(query.origin !== undefined ? { origin: query.origin } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    };
  }

  // Registered before ':id' — otherwise 'search'/'timeline' parse as ids.
  @Get('search')
  async search(
    @Query() query: SearchClaimsQueryDto,
  ): Promise<SearchClaimsResponseDto> {
    let hits: SimilarClaim[];
    try {
      hits = await this.index.searchSimilar(query.q, query.k ?? 5);
    } catch (err) {
      if (err instanceof ClaimIndexUnavailableError) {
        return { results: [], degraded: true, reason: err.message };
      }
      throw err;
    }
    const results: (Claim & { score: number })[] = [];
    for (const hit of hits) {
      const claim = await this.claims.getClaim(hit.claimId);
      if (claim) results.push({ ...claim, score: hit.score });
    }
    return { results, degraded: false };
  }

  /**
   * Timeline axis (M12e): recall along *when* — creation window,
   * optionally scoped to one conversation (resolved through
   * evidence references; claims store no session of their own).
   * Newest first. No new write paths.
   */
  @Get('timeline')
  async timeline(
    @Query() query: TimelineClaimsQueryDto,
  ): Promise<TimelineClaimsResponseDto> {
    return {
      claims: await this.claims.listClaimsByTime({
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.sessionId !== undefined
          ? { sessionId: query.sessionId }
          : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ClaimDetailResponseDto> {
    const claim = await this.claims.getClaim(id);
    if (!claim) throw new NotFoundException(`Unknown claim "${id}"`);
    const evidence: (MemoryCandidate | null)[] = [];
    for (const item of claim.evidence) {
      evidence.push(await this.candidates.getCandidate(item.candidateId));
    }
    return {
      claim,
      evidence,
      history: await this.journal.listByClaimId(id),
      maintenance: await this.history.listByClaimId(id),
    };
  }

  /**
   * Deliberate retirement (M12b): explicit status transition with
   * history — the `retired` writer. Missing rows 404; ineligible
   * rows 400 unless forced (explicit "forget this", caller = HITL
   * authority, bypass recorded). Retirement is never a delete:
   * the row stays queryable with full history.
   */
  @Post(':id/retire')
  @HttpCode(200)
  async retire(
    @Param('id') id: string,
    @Body() body: RetireClaimDto,
  ): Promise<RetireClaimResponseDto> {
    try {
      const claim = await this.maintenance.retireClaim(id, {
        force: body.force,
      });
      if (!claim) throw new NotFoundException(`Unknown claim "${id}"`);
      return { claim };
    } catch (err) {
      if (err instanceof RetirementIneligibleError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
