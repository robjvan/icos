import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { ChannelDatabaseService } from './channel-database.service';
import { SqliteChannelRepository } from './sqlite-channel.repository';

function testConfig(dir: string): CoreConfig {
  return {
    memoryDbPath: join(dir, 'memories.db'),
    channelsDbPath: join(dir, 'channels.db'),
  } as unknown as CoreConfig;
}

// Far-future fixed times so a default (now-scheduled) delivery is always
// due at NOW regardless of the real wall clock.
const NOW = '2099-01-01T00:00:00.000Z';
const SOON = '2099-01-01T00:05:00.000Z';
const LATER = '2099-06-01T00:00:00.000Z';

describe('SqliteChannelRepository', () => {
  let dir: string;
  let database: ChannelDatabaseService;
  let repository: SqliteChannelRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-channels-'));
    database = new ChannelDatabaseService(testConfig(dir));
    database.onModuleInit();
    repository = new SqliteChannelRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a message with attachments and provenance', async () => {
    const message = await repository.recordMessage({
      channel: 'discord',
      direction: 'inbound',
      conversationKey: 'discord:g1:c1',
      peerId: 'u1',
      sessionId: 'discord:g1:c1',
      body: 'hello',
      externalId: 'm1',
      attachments: [{ url: 'https://cdn/x.png', name: 'x.png' }],
      provenance: { authTrust: 'transport' },
    });

    expect(message.id).toBeTruthy();
    expect(message.attachments).toHaveLength(1);
    expect(message.provenance).toMatchObject({ authTrust: 'transport' });

    const found = await repository.findMessageByExternalId('discord', 'm1');
    expect(found?.id).toBe(message.id);
    expect(await repository.getMessage(message.id)).toMatchObject({
      body: 'hello',
    });
  });

  it('rejects a duplicate inbound transport id (idempotency guard)', async () => {
    const input = {
      channel: 'discord' as const,
      direction: 'inbound' as const,
      conversationKey: 'discord:g1:c1',
      body: 'hi',
      externalId: 'dup-1',
    };
    await repository.recordMessage(input);
    await expect(repository.recordMessage(input)).rejects.toThrow();
  });

  it('lists messages for a conversation in insertion order', async () => {
    for (const body of ['first', 'second', 'third']) {
      await repository.recordMessage({
        channel: 'discord',
        direction: 'inbound',
        conversationKey: 'discord:g1:c1',
        body,
      });
    }
    await repository.recordMessage({
      channel: 'discord',
      direction: 'inbound',
      conversationKey: 'discord:g1:other',
      body: 'elsewhere',
    });

    const messages = await repository.listMessages('discord:g1:c1');
    expect(messages.map((m) => m.body)).toEqual(['first', 'second', 'third']);
  });

  it('maps a conversation to one session across messages', async () => {
    const first = await repository.recordMessage({
      channel: 'discord',
      direction: 'inbound',
      conversationKey: 'discord:g1:c1',
      body: 'a',
    });
    expect(await repository.findSessionId('discord:g1:c1')).toBeNull();

    await repository.updateMessageSession(first.id, 'sess-1');
    expect(await repository.findSessionId('discord:g1:c1')).toBe('sess-1');
  });

  it('enqueues, claims, and marks a delivery sent', async () => {
    const delivery = await repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'a reply',
    });
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(0);

    const claimed = await repository.claimDueDelivery(NOW);
    expect(claimed?.id).toBe(delivery.id);
    expect(claimed?.status).toBe('sending');
    expect(claimed?.attempts).toBe(1);

    const sent = await repository.markDeliverySent(delivery.id, 'ext-42');
    expect(sent).toMatchObject({
      status: 'sent',
      externalMessageId: 'ext-42',
      nextAttemptAt: null,
    });
  });

  it('does not claim a delivery that is not yet due', async () => {
    await repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'later',
      nextAttemptAt: LATER,
    });
    expect(await repository.claimDueDelivery(NOW)).toBeNull();
    expect(await repository.claimDueDelivery(LATER)).not.toBeNull();
  });

  it('retries a failed delivery, then abandons it when no retry is scheduled', async () => {
    const delivery = await repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'flaky',
    });
    await repository.claimDueDelivery(NOW);

    const failed = await repository.markDeliveryFailed(
      delivery.id,
      'network down',
      SOON,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      nextAttemptAt: SOON,
      lastError: 'network down',
    });

    // Retry is not due until SOON.
    expect(await repository.claimDueDelivery(NOW)).toBeNull();
    const retried = await repository.claimDueDelivery(SOON);
    expect(retried?.attempts).toBe(2);

    const abandoned = await repository.markDeliveryFailed(
      delivery.id,
      'gave up',
      null,
    );
    expect(abandoned).toMatchObject({
      status: 'abandoned',
      attempts: 2,
      nextAttemptAt: null,
    });
    expect(await repository.claimDueDelivery(LATER)).toBeNull();
  });

  it('lists deliveries by status', async () => {
    await repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'one',
    });
    await repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: 'discord:g1:c1',
      body: 'two',
    });

    // Claiming picks the earliest-created delivery first.
    const claimed = await repository.claimDueDelivery(NOW);
    expect(claimed?.body).toBe('one');

    const pending = await repository.listDeliveries('pending');
    expect(pending.map((d) => d.body)).toEqual(['two']);

    expect(claimed).not.toBeNull();
    await repository.markDeliverySent(claimed?.id ?? '', 'ext-1');
    const sent = await repository.listDeliveries('sent');
    expect(sent.map((d) => d.body)).toEqual(['one']);
  });
});
