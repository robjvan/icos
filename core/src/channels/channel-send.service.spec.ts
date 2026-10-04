import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { ChannelDatabaseService } from './channel-database.service';
import type { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelSendService } from './channel-send.service';
import { SqliteChannelRepository } from './sqlite-channel.repository';

function testConfig(dir: string): CoreConfig {
  return {
    memoryDbPath: join(dir, 'memories.db'),
    channelsDbPath: join(dir, 'channels.db'),
  } as unknown as CoreConfig;
}

describe('ChannelSendService', () => {
  let dir: string;
  let database: ChannelDatabaseService;
  let repository: SqliteChannelRepository;
  let runOnce: jest.Mock;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-send-'));
    database = new ChannelDatabaseService(testConfig(dir));
    database.onModuleInit();
    repository = new SqliteChannelRepository(database);
    runOnce = jest.fn(() => Promise.resolve(1));
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const build = (): ChannelSendService =>
    new ChannelSendService(repository, {
      runOnce,
    } as unknown as ChannelDeliveryService);

  it('records an outbound message and enqueues a delivery', async () => {
    const service = build();

    const result = await service.send({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'hello out there',
    });

    expect(result.message).toMatchObject({
      channel: 'discord',
      direction: 'outbound',
      conversationKey: 'discord:g1:c1',
      body: 'hello out there',
    });
    expect(result.delivery).toMatchObject({
      status: 'pending',
      body: 'hello out there',
    });
    expect(runOnce).toHaveBeenCalledTimes(1);

    const messages = await repository.listMessages('discord:g1:c1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: 'outbound' });
    expect(await repository.listDeliveries('pending')).toHaveLength(1);
  });

  it('carries caller provenance', async () => {
    const service = build();
    const { message } = await service.send({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'x',
      provenance: { source: 'agent-tool' },
    });
    expect(message.provenance).toMatchObject({ source: 'agent-tool' });
  });
});
