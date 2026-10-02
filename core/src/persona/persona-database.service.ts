import { Inject, Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';

/**
 * The persona database: the curated self-model, kept in its own file so
 * it is isolated from the memory stores by construction. No legacy
 * migration — M14 introduces this store.
 */
@Injectable()
export class PersonaDatabaseService extends DatabaseService {
  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    super(resolvePersonaDbPath(config), 'persona');
  }
}

/**
 * `loadConfig` always sets `personaDbPath`; it is optional on the type so
 * test configs that never open the store need not carry it. Fall back to
 * a sibling of the memory database, which lives in the same data dir.
 */
function resolvePersonaDbPath(config: CoreConfig): string {
  return (
    config.personaDbPath ?? join(dirname(config.memoryDbPath), 'persona.db')
  );
}
