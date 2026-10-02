import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { PersonaController } from './persona.controller';
import { PersonaCoreService } from './persona-core.service';
import { PersonaDatabaseService } from './persona-database.service';
import { PersonaGroundingService } from './persona-grounding.service';
import { PersonaSeedImportService } from './persona-seed-import.service';
import { PersonaRepository } from './persona.repository';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

/**
 * M14 persona subsystem. Self-contained: owns its database service and
 * repository, and exports both for later slices (grounding, review, UI)
 * to consume. Kept out of the memory composition root deliberately — the
 * persona store is isolated from memory, not another memory repository.
 */
@Module({
  controllers: [PersonaController],
  providers: [
    coreConfigProvider,
    // Order matters for lifecycle: the database opens, then the core
    // loader reads its file and records the load in that database.
    PersonaDatabaseService,
    {
      provide: PersonaRepository,
      useClass: SqlitePersonaRepository,
    },
    PersonaCoreService,
    PersonaSeedImportService,
    PersonaGroundingService,
  ],
  exports: [
    PersonaDatabaseService,
    PersonaRepository,
    PersonaCoreService,
    PersonaSeedImportService,
    PersonaGroundingService,
  ],
})
export class PersonaModule {}
