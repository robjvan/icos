import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { PersonaCoreService } from './persona-core.service';
import { PersonaGroundingService } from './persona-grounding.service';
import { PersonaQueryService } from './persona-query.service';
import type { PersonaOverview } from './persona-query.service';
import { PersonaReviewService } from './persona-review.service';
import { PersonaSeedImportService } from './persona-seed-import.service';
import { PersonaReviewDto } from './dto/persona-review.dto';
import { PersonaSeedImportDto } from './dto/persona-seed.dto';
import type {
  PersonaCandidate,
  PersonaCoreEntry,
  PersonaCoreStatus,
  PersonaDriftEntry,
  PersonaGroundingStatus,
  PersonaReviewResult,
  PersonaSeedImportResult,
} from './persona.types';

/** Read-only view of the immutable core persona (M14b). Admin-only. */
export interface PersonaCoreView extends PersonaCoreStatus {
  entries: readonly PersonaCoreEntry[];
}

@Controller('core/persona')
export class PersonaController {
  constructor(
    private readonly core: PersonaCoreService,
    private readonly seeds: PersonaSeedImportService,
    private readonly grounding: PersonaGroundingService,
    private readonly review: PersonaReviewService,
    private readonly query: PersonaQueryService,
  ) {}

  /**
   * The core is read-only by design: this endpoint can only ever return
   * it. There is no corresponding mutation route.
   */
  @RequireRole('admin')
  @Get('core')
  getCore(): PersonaCoreView {
    return { ...this.core.getStatus(), entries: this.core.getEntries() };
  }

  /** Grounding result + provenance bundle (M14d). Admin-only, read-only. */
  @RequireRole('admin')
  @Get('grounding')
  getGrounding(): Promise<PersonaGroundingStatus> {
    return this.grounding.status();
  }

  /** Pending persona candidates awaiting review (M14f). Admin-only. */
  @RequireRole('admin')
  @Get('candidates')
  async getPendingCandidates(): Promise<{ candidates: PersonaCandidate[] }> {
    return { candidates: await this.query.pending() };
  }

  /** The evolving tier: identity records, user facts, relationship (M14g). */
  @RequireRole('admin')
  @Get('records')
  getRecords(): Promise<PersonaOverview> {
    return this.query.overview();
  }

  /** Drift / audit history, newest first (M14g). Admin-only. */
  @RequireRole('admin')
  @Get('drift')
  async getDrift(): Promise<{ drift: PersonaDriftEntry[] }> {
    return { drift: await this.query.drift() };
  }

  /**
   * Apply a review outcome (M14f). Admin-only, CSRF-gated by the global
   * guard. A candidate contradicting the immutable core is refused.
   */
  @RequireRole('admin')
  @Post('candidates/:id/review')
  @HttpCode(200)
  reviewCandidate(
    @Param('id') candidateId: string,
    @Body() dto: PersonaReviewDto,
  ): Promise<PersonaReviewResult> {
    return this.review.review(candidateId, dto);
  }

  /**
   * Import persona seed Markdown into the evolving tier (M14c). Never
   * targets the core. Admin-only; CSRF-gated by the global guard.
   */
  @RequireRole('admin')
  @Post('seeds/import')
  @HttpCode(200)
  importSeeds(
    @Body() dto: PersonaSeedImportDto,
  ): Promise<PersonaSeedImportResult> {
    return this.seeds.import(dto);
  }
}
