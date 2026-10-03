/* eslint-disable @typescript-eslint/require-await --
   async is required by the ConversationService / ChannelAdapter contracts;
   the fake stubs are intentionally trivial. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import type {
  ConversationService,
  TurnOutcome,
} from '../conversation/conversation.service';
import { ChannelDatabaseService } from './channel-database.service';
import type { DiscordAdapter } from './discord.adapter';
import { DiscordIngressService } from './discord-ingress.service';
import type { DiscordInbound, DiscordMessageHandler } from './discord.types';
import { SqliteChannelRepository } from './sqlite-channel.repository';

function testConfig(
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    memoryDbPath: join(dir, 'memories.db'),
    channelsDbPath: join(dir, 'channels.db'),
    discordAllowDirectMessages: true,
    discordAllowedChannelIds: [],
    discordAllowedUserIds: [],
    ...overrides,
  } as unknown as CoreConfig;
}

function inbound(overrides: Partial<DiscordInbound> = {}): DiscordInbound {
  return {
    externalId: 'm1',
    channelId: 'c1',
    guildId: 'g1',
    isDm: false,
    isThread: false,
    parentChannelId: 'c1',
    channelTopic: '[icos-stream: chat]',
    authorId: 'u1',
    content: 'hello',
    attachments: [],
    ...overrides,
  };
}

class FakeAdapter {
  handler: DiscordMessageHandler | null = null;
  onMessage(handler: DiscordMessageHandler): void {
    this.handler = handler;
  }
}

function fakeConversation(): {
  service: ConversationService;
  converse: jest.Mock<Promise<TurnOutcome>, [string, (string | undefined)?]>;
} {
  const converse = jest.fn(
    async (message: string, sessionId?: string): Promise<TurnOutcome> => ({
      status: 'ok',
      sessionId: sessionId ?? 'sess-new',
      requestId: 'req',
      reply: `echo:${message}`,
      model: 'test-model',
    }),
  );
  return { service: { converse } as unknown as ConversationService, converse };
}

describe('DiscordIngressService', () => {
  let dir: string;
  let database: ChannelDatabaseService;
  let repository: SqliteChannelRepository;
  let adapter: FakeAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-ingress-'));
    database = new ChannelDatabaseService(testConfig(dir));
    database.onModuleInit();
    repository = new SqliteChannelRepository(database);
    adapter = new FakeAdapter();
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const build = (
    config: CoreConfig,
    conversation: ConversationService,
  ): DiscordIngressService =>
    new DiscordIngressService(
      config,
      adapter as unknown as DiscordAdapter,
      repository,
      conversation,
    );

  describe('accept policy', () => {
    it('accepts a topic-designated channel and rejects others', () => {
      const service = build(testConfig(dir), fakeConversation().service);
      expect(service.accepts(inbound())).toBe(true);
      expect(
        service.accepts(inbound({ channelTopic: 'general chatter' })),
      ).toBe(false);
    });

    it('accepts an allowlisted channel that has no topic marker', () => {
      const service = build(
        testConfig(dir, { discordAllowedChannelIds: ['c9'] }),
        fakeConversation().service,
      );
      expect(
        service.accepts(
          inbound({
            channelId: 'c9',
            parentChannelId: 'c9',
            channelTopic: null,
          }),
        ),
      ).toBe(true);
    });

    it('answers DMs only for allowlisted users (operator-only)', () => {
      const open = build(testConfig(dir), fakeConversation().service);
      expect(open.accepts(inbound({ isDm: true, guildId: null }))).toBe(false);

      const allowed = build(
        testConfig(dir, { discordAllowedUserIds: ['u1'] }),
        fakeConversation().service,
      );
      expect(allowed.accepts(inbound({ isDm: true, guildId: null }))).toBe(
        true,
      );

      const disabled = build(
        testConfig(dir, {
          discordAllowedUserIds: ['u1'],
          discordAllowDirectMessages: false,
        }),
        fakeConversation().service,
      );
      expect(disabled.accepts(inbound({ isDm: true, guildId: null }))).toBe(
        false,
      );
    });

    it('restricts guild answers to the user allowlist when set', () => {
      const restricted = build(
        testConfig(dir, { discordAllowedUserIds: ['someone-else'] }),
        fakeConversation().service,
      );
      expect(restricted.accepts(inbound())).toBe(false);
    });

    it('keys DMs and threads distinctly', () => {
      const service = build(testConfig(dir), fakeConversation().service);
      expect(
        service.conversationKey(inbound({ isDm: true, guildId: null })),
      ).toBe('discord:dm:u1');
      expect(
        service.conversationKey(
          inbound({ isThread: true, channelId: 't1', parentChannelId: 'c1' }),
        ),
      ).toBe('discord:g1:c1:thread:t1');
    });
  });

  it('records the message, runs a turn, and queues the reply', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ content: 'hi bot' }));

    expect(converse).toHaveBeenCalledWith('hi bot', undefined);
    const messages = await repository.listMessages('discord:g1:c1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: 'inbound',
      body: 'hi bot',
      sessionId: 'sess-new',
    });
    const deliveries = await repository.listDeliveries('pending');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      conversationKey: 'discord:g1:c1',
      body: 'echo:hi bot',
    });
  });

  it('is idempotent on a repeated transport id', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ externalId: 'dup' }));
    await service.handle(inbound({ externalId: 'dup' }));

    expect(converse).toHaveBeenCalledTimes(1);
    expect(await repository.listDeliveries('pending')).toHaveLength(1);
  });

  it('reuses one durable session across turns in a conversation', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ externalId: 'a', content: 'first' }));
    // First turn created 'sess-new'; the second should reuse it.
    await service.handle(inbound({ externalId: 'b', content: 'second' }));

    expect(converse).toHaveBeenNthCalledWith(1, 'first', undefined);
    expect(converse).toHaveBeenNthCalledWith(2, 'second', 'sess-new');
  });

  it('ignores a message that fails the accept policy', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ channelTopic: 'just chatting' }));

    expect(converse).not.toHaveBeenCalled();
    expect(await repository.listMessages('discord:g1:c1')).toHaveLength(0);
  });
});
