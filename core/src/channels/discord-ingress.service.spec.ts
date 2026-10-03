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
import type { ChannelDeliveryService } from './channel-delivery.service';
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
    mentionsBot: true,
    parentChannelId: 'c1',
    channelTopic: '[icos-stream: chat]',
    parentTopic: '[icos-stream: chat]',
    authorId: 'u1',
    content: 'hello',
    attachments: [],
    ...overrides,
  };
}

class FakeAdapter {
  handler: DiscordMessageHandler | null = null;
  readonly typing: string[] = [];
  readonly sent: { key: string; body: string }[] = [];
  readonly edited: { key: string; id: string; body: string }[] = [];
  readonly threads: { channelId: string; messageId: string; name: string }[] =
    [];
  threadId: string | null = 'thread-1';

  onMessage(handler: DiscordMessageHandler): void {
    this.handler = handler;
  }
  selfName(): string | null {
    return 'bot#1';
  }
  async sendTyping(conversationKey: string): Promise<void> {
    this.typing.push(conversationKey);
  }
  async send(
    conversationKey: string,
    body: string,
  ): Promise<{ externalMessageId: string | null }> {
    this.sent.push({ key: conversationKey, body });
    return { externalMessageId: 'ph-1' };
  }
  async edit(conversationKey: string, id: string, body: string): Promise<void> {
    this.edited.push({ key: conversationKey, id, body });
  }
  async startThread(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<string | null> {
    this.threads.push({ channelId, messageId, name });
    return this.threadId;
  }
}

function fakeConversation(): {
  service: ConversationService;
  converse: jest.Mock<
    Promise<TurnOutcome>,
    [string, (string | undefined)?, { sourceBand?: string }?]
  >;
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
      {
        runOnce: jest.fn(async () => 0),
      } as unknown as ChannelDeliveryService,
    );

  describe('accept policy', () => {
    it('accepts a topic-designated channel message that mentions the bot', () => {
      const service = build(testConfig(dir), fakeConversation().service);
      expect(service.accepts(inbound())).toBe(true);
    });

    it('rejects a channel message that does not mention the bot', () => {
      const service = build(testConfig(dir), fakeConversation().service);
      expect(service.accepts(inbound({ mentionsBot: false }))).toBe(false);
    });

    it('rejects a channel that is not designated', () => {
      const service = build(testConfig(dir), fakeConversation().service);
      expect(
        service.accepts(
          inbound({
            channelTopic: 'general chatter',
            parentTopic: 'general chatter',
          }),
        ),
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
            parentTopic: null,
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

  it('starts a thread for a channel mention and edits the reply into the placeholder', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ content: 'hi bot' }));

    expect(adapter.threads).toEqual([
      { channelId: 'c1', messageId: 'm1', name: 'hi bot' },
    ]);
    expect(adapter.sent).toEqual([
      { key: 'discord:g1:c1:thread:thread-1', body: '🤔 thinking…' },
    ]);
    expect(adapter.edited).toEqual([
      {
        key: 'discord:g1:c1:thread:thread-1',
        id: 'ph-1',
        body: 'echo:hi bot',
      },
    ]);
    const messages = await repository.listMessages(
      'discord:g1:c1:thread:thread-1',
    );
    expect(messages).toHaveLength(1);
    expect(converse).toHaveBeenCalledWith(
      'hi bot',
      undefined,
      expect.anything(),
    );
  });

  it('does not thread a DM', async () => {
    const { service: conversation } = fakeConversation();
    const service = build(
      testConfig(dir, { discordAllowedUserIds: ['u1'] }),
      conversation,
    );

    await service.handle(inbound({ isDm: true, guildId: null, content: 'yo' }));

    expect(adapter.threads).toHaveLength(0);
    expect(adapter.sent[0]?.key).toBe('discord:dm:u1');
  });

  it('is idempotent on a repeated transport id', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ externalId: 'dup', content: 'x' }));
    await service.handle(inbound({ externalId: 'dup', content: 'x' }));

    expect(converse).toHaveBeenCalledTimes(1);
    expect(adapter.edited).toHaveLength(1);
  });

  it('reuses one durable session across turns in a thread', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);
    const threaded = (externalId: string, content: string) =>
      inbound({
        externalId,
        content,
        isThread: true,
        channelId: 't1',
        parentChannelId: 'c1',
      });

    await service.handle(threaded('a', 'first'));
    await service.handle(threaded('b', 'second'));

    expect(converse).toHaveBeenNthCalledWith(
      1,
      'first',
      undefined,
      expect.anything(),
    );
    expect(converse).toHaveBeenNthCalledWith(
      2,
      'second',
      'sess-new',
      expect.anything(),
    );
  });

  it('tells the model where the turn came from', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ content: 'hi' }));

    expect(converse.mock.calls[0]?.[2]?.sourceBand).toContain('Discord');
    expect(converse.mock.calls[0]?.[2]?.sourceBand).toContain('bot#1');
  });

  it('edits a visible error into the placeholder when the turn fails', async () => {
    const converse = jest.fn(async () => {
      throw new Error('LLM endpoint returned an invalid completion');
    });
    const service = build(testConfig(dir), {
      converse,
    } as unknown as ConversationService);

    await service.handle(inbound({ content: 'boom' }));

    expect(adapter.edited).toHaveLength(1);
    expect(adapter.edited[0]?.body).toContain('error');
  });

  it('ignores a message that fails the accept policy', async () => {
    const { service: conversation, converse } = fakeConversation();
    const service = build(testConfig(dir), conversation);

    await service.handle(inbound({ mentionsBot: false }));

    expect(converse).not.toHaveBeenCalled();
    expect(adapter.sent).toHaveLength(0);
    expect(await repository.listMessages('discord:g1:c1')).toHaveLength(0);
  });
});
