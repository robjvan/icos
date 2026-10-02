import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { PersonaDatabaseService } from './persona-database.service';
import { PersonaRepository } from './persona.repository';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

/**
 * M14 persona subsystem. Self-contained: owns its database service and
 * repository, and exports both for later slices (grounding, review, UI)
 * to consume. Kept out of the memory composition root deliberately — the
 * persona store is isolated from memory, not another memory repository.
 */
@Module({
  providers: [
    coreConfigProvider,
    PersonaDatabaseService,
    {
      provide: PersonaRepository,
      useClass: SqlitePersonaRepository,
    },
  ],
  exports: [PersonaDatabaseService, PersonaRepository],
})
export class PersonaModule {}
