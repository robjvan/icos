import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { PersonaCoreService } from './persona-core.service';
import { PersonaSeedImportService } from './persona-seed-import.service';
import { PersonaSeedImportDto } from './dto/persona-seed.dto';
import type {
  PersonaCoreEntry,
  PersonaCoreStatus,
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
