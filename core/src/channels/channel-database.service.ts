import { Inject, Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';

/**
 * The channel database: the unified inbound/outbound message ledger and
 * the durable outbound delivery queue. Its own file, like persona —
 * channel traffic is its own subsystem. No legacy migration; M16
 * introduces this store.
 */
@Injectable()
export class ChannelDatabaseService extends DatabaseService {
  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    super(resolveChannelsDbPath(config), 'channels');
  }
}

/**
 * `loadConfig` always sets `channelsDbPath`; it is optional on the type so
 * test configs that never open the store need not carry it. Fall back to
 * a sibling of the memory database, which lives in the same data dir.
 */
function resolveChannelsDbPath(config: CoreConfig): string {
  return (
    config.channelsDbPath ?? join(dirname(config.memoryDbPath), 'channels.db')
  );
}
