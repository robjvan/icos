/* eslint-disable @typescript-eslint/require-await --
   async is required by the ChannelAdapter contract; the fake stubs are
   intentionally trivial. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
} from './channel-adapter';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { SqliteChannelRepository } from './sqlite-channel.repository';
import type { ChannelName } from './channel.types';

class FakeAdapter implements ChannelAdapter {
  readonly name: ChannelName = 'discord';
  connected = true;
  failWith: string | null = null;
  readonly sent: { conversationKey: string; body: string }[] = [];

  async connect(): Promise<void> {
    /* no-op */
  }

  async disconnect(): Promise<void> {
    /* no-op */
  }

  isConnected(): boolean {
    return this.connected;
  }

  health(): ChannelHealth {
    return { channel: this.name, connected: this.connected };
  }

  async send(
    conversationKey: string,
    body: string,
  ): Promise<ChannelSendResult> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push({ conversationKey, body });
    return { externalMessageId: 'ext-1' };
  }
}

function testConfig(
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    memoryDbPath: join(dir, 'memories.db'),
    channelsDbPath: join(dir, 'channels.db'),
    channelDeliveryEnabled: true,
    channelDeliveryIntervalMs: 60000,
    channelDeliveryBatch: 10,
    channelDeliveryMaxAttempts: 3,
    channelDeliveryBackoffBaseMs: 1000,
    channelDeliveryBackoffCapMs: 30000,
    channelSendMinIntervalMs: 0,
    ...overrides,
  } as unknown as CoreConfig;
}

describe('ChannelDeliveryService', () => {
  let dir: string;
  let database: ChannelDatabaseService;
  let repository: SqliteChannelRepository;
  let adapter: FakeAdapter;

  const build = (overrides: Partial<CoreConfig> = {}): ChannelDeliveryService =>
    new ChannelDeliveryService(testConfig(dir, overrides), repository, [
      adapter,
    ]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-delivery-'));
    database = new ChannelDatabaseService(testConfig(dir));
    database.onModuleInit();
    repository = new SqliteChannelRepository(database);
    adapter = new FakeAdapter();
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const enqueue = (body: string) =>
    repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body,
    });

  it('sends a due delivery and marks it sent', async () => {
    const delivery = await enqueue('hello out there');
    const service = build();

    expect(await service.runOnce()).toBe(1);

    expect(adapter.sent).toEqual([
      { conversationKey: 'discord:g1:c1', body: 'hello out there' },
    ]);
    expect(await repository.getDelivery(delivery.id)).toMatchObject({
      status: 'sent',
      externalMessageId: 'ext-1',
      attempts: 1,
    });
  });

  it('fails a delivery when its channel is not connected', async () => {
    adapter.connected = false;
    const delivery = await enqueue('nope');
    const service = build();

    expect(await service.runOnce()).toBe(0);

    const after = await repository.getDelivery(delivery.id);
    expect(after).toMatchObject({ status: 'failed', attempts: 1 });
    expect(after?.lastError).toContain('not available');
    expect(after?.nextAttemptAt).not.toBeNull();
  });

  it('retries with backoff, then abandons at the attempt cap', async () => {
    adapter.failWith = 'boom';
    const delivery = await enqueue('flaky');
    // Backoff 0 so the retry is immediately due within the same pass.
    const service = build({ channelDeliveryBackoffBaseMs: 0 });

    await service.runOnce();

    const after = await repository.getDelivery(delivery.id);
    expect(after).toMatchObject({ status: 'abandoned', attempts: 3 });
    expect(after?.lastError).toBe('boom');
    expect(after?.nextAttemptAt).toBeNull();
  });

  it('returns adapter health', () => {
    const service = build();
    expect(service.health()).toEqual([{ channel: 'discord', connected: true }]);
  });
});
