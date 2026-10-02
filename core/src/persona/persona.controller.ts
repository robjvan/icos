import { Controller, Get } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { PersonaCoreService } from './persona-core.service';
import type { PersonaCoreEntry, PersonaCoreStatus } from './persona.types';

/** Read-only view of the immutable core persona (M14b). Admin-only. */
export interface PersonaCoreView extends PersonaCoreStatus {
  entries: readonly PersonaCoreEntry[];
}

@Controller('core/persona')
export class PersonaController {
  constructor(private readonly core: PersonaCoreService) {}

  /**
   * The core is read-only by design: this endpoint can only ever return
   * it. There is no corresponding mutation route.
   */
  @RequireRole('admin')
  @Get('core')
  getCore(): PersonaCoreView {
    return { ...this.core.getStatus(), entries: this.core.getEntries() };
  }
}
