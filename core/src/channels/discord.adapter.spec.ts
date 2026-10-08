/* eslint-disable @typescript-eslint/require-await --
   async is required by the ChannelAdapter / discord.js-like contracts;
   the fake stubs are intentionally trivial. */
import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import type {
  DiscordChannelLike,
  DiscordClientLike,
  DiscordGuildLike,
  DiscordUserLike,
} from './discord.adapter';
import {
  DiscordAdapter,
  normalizeDiscordMessage,
  parseDiscordTargetKey,
  splitForDiscord,
} from './discord.adapter';
import type { DiscordInbound } from './discord.types';

class FakeMessageHandle {
  readonly edited: string[] = [];
  readonly threads: string[] = [];
  async edit(content: string): Promise<unknown> {
    this.edited.push(content);
    return this;
  }
  async startThread(options: { name: string }): Promise<{ id: string }> {
    this.threads.push(options.name);
    return { id: 'thread-1' };
  }
}

class FakeChannel implements DiscordChannelLike {
  readonly sent: string[] = [];
  readonly handles = new Map<string, FakeMessageHandle>();
  readonly messages = {
    fetch: async (id: string): Promise<FakeMessageHandle> =>
      this.handles.get(id) ?? new FakeMessageHandle(),
  };
  id = 'c1';
  name?: string;
  topic: string | null = null;
  guildId: string | null = 'g1';
  constructor(private readonly textBased = true) {}
  isTextBased(): boolean {
    return this.textBased;
  }
  async send(content: string): Promise<{ id: string }> {
    this.sent.push(content);
    return { id: 'msg-1' };
  }
}

class FakeClient implements DiscordClientLike {
  private readyHandler: ((...args: unknown[]) => void) | null = null;
  loginCalled = false;
  destroyed = false;
  loginError: Error | null = null;
  user = { tag: 'bot#1' };
  readonly channelsById = new Map<string, DiscordChannelLike>();
  readonly channels = {
    fetch: async (id: string): Promise<DiscordChannelLike | null> =>
      this.channelsById.get(id) ?? null,
  };
  readonly guilds: { cache: Map<string, DiscordGuildLike> } = {
    cache: new Map(),
  };
  readonly dmChannel: DiscordChannelLike = new FakeChannel();
  readonly users: { fetch(id: string): Promise<DiscordUserLike> } = {
    fetch: async () => ({ createDM: async () => this.dmChannel }),
  };

  async login(): Promise<unknown> {
    this.loginCalled = true;
    if (this.loginError) throw this.loginError;
    return 'ok';
  }

  destroy(): void {
    this.destroyed = true;
  }

  private readonly handlers = new Map<
    string,
    ((...args: unknown[]) => void)[]
  >();

  on(event: string, handler: (...args: unknown[]) => void): unknown {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  once(event: string, handler: (...args: unknown[]) => void): unknown {
    if (event === 'ready') this.readyHandler = handler;
    return this;
  }

  emitReady(): void {
    this.readyHandler?.(this);
  }
}

function config(token: string | undefined): CoreConfig {
  return { discordBotToken: token } as unknown as CoreConfig;
}

const secrets = { resolve: () => null } as unknown as SecretResolver;

describe('DiscordAdapter', () => {
  it('is disabled (never blocks) when no token is configured', async () => {
    const adapter = new DiscordAdapter(
      config(undefined),
      secrets,
      async () => new FakeClient(),
    );
    await adapter.connect();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.health()).toMatchObject({
      channel: 'discord',
      connected: false,
      detail: 'no token configured',
    });
    await expect(adapter.send('discord:g:c', 'hi')).rejects.toThrow(
      'not connected',
    );
  });

  it('logs in, becomes ready, and sends to a channel', async () => {
    const client = new FakeClient();
    const channel = new FakeChannel();
    client.channelsById.set('c1', channel);
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );

    await adapter.connect();
    expect(client.loginCalled).toBe(true);
    expect(adapter.isConnected()).toBe(false); // not ready until the event fires

    client.emitReady();
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.health()).toMatchObject({ connected: true });

    const result = await adapter.send('discord:g:c1', 'hello');
    expect(channel.sent).toEqual(['hello']);
    expect(result.externalMessageId).toBe('msg-1');
  });

  it('runs info + moderation through the admin port (M17c.4)', async () => {
    const client = new FakeClient();
    const channel = new FakeChannel();
    channel.id = 'c1';
    channel.name = 'general';
    const timedOut: {
      userId: string;
      durationMs: number;
      reason?: string;
    }[] = [];
    const kicked: string[] = [];
    const member = {
      id: 'u1',
      displayName: 'Ada',
      joinedAt: new Date('2020-01-02T00:00:00Z'),
      roles: { cache: new Map([['r1', { name: 'admin' }]]) },
      timeout: async (durationMs: number, reason?: string) => {
        timedOut.push({ userId: 'u1', durationMs, reason });
      },
      kick: async (reason?: string) => {
        kicked.push(reason ?? '');
      },
    };
    client.guilds.cache.set('g1', {
      id: 'g1',
      name: 'Test Guild',
      memberCount: 42,
      channels: { cache: new Map([['c1', channel]]) },
      members: {
        fetch: async (id: string) =>
          id === 'u1' ? member : Promise.reject(new Error('not found')),
      },
    });

    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    expect(await adapter.run({ action: 'server_info' })).toMatchObject({
      id: 'g1',
      name: 'Test Guild',
      memberCount: 42,
    });
    expect(
      await adapter.run({ action: 'member_info', userId: 'u1' }),
    ).toMatchObject({ id: 'u1', displayName: 'Ada', roles: ['admin'] });
    expect(
      await adapter.run({
        action: 'timeout_member',
        userId: 'u1',
        durationMs: 60000,
        reason: 'spam',
      }),
    ).toMatchObject({ timedOut: true });
    expect(timedOut).toEqual([
      { userId: 'u1', durationMs: 60000, reason: 'spam' },
    ]);
    expect(
      await adapter.run({ action: 'kick_member', userId: 'u1' }),
    ).toMatchObject({ kicked: true });
    expect(kicked).toEqual(['']);
  });

  it('resolves a thread target from the conversation key', async () => {
    const client = new FakeClient();
    const thread = new FakeChannel();
    client.channelsById.set('t9', thread);
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    await adapter.send('discord:g:c1:thread:t9', 'in thread');
    expect(thread.sent).toEqual(['in thread']);
  });

  it('rejects an unsupported conversation key', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    await expect(adapter.send('email:someone', 'x')).rejects.toThrow(
      'unsupported',
    );
  });

  it('degrades (does not throw) when login fails', async () => {
    const client = new FakeClient();
    client.loginError = new Error('bad token');
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );

    await adapter.connect();

    expect(adapter.isConnected()).toBe(false);
    expect(adapter.health().detail).toBe('bad token');
  });

  it('parses target keys', () => {
    expect(parseDiscordTargetKey('discord:g:c')).toEqual({
      kind: 'channel',
      id: 'c',
    });
    expect(parseDiscordTargetKey('discord:g:c:thread:t')).toEqual({
      kind: 'channel',
      id: 't',
    });
    expect(parseDiscordTargetKey('discord:dm:u1')).toEqual({
      kind: 'dm',
      id: 'u1',
    });
    expect(parseDiscordTargetKey('nope')).toBeNull();
  });

  it('sends to a DM by resolving the user to a DM channel', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    const dm = client.dmChannel as FakeChannel;
    const result = await adapter.send('discord:dm:u1', 'hello dm');

    expect(dm.sent).toEqual(['hello dm']);
    expect(result.externalMessageId).toBe('msg-1');
  });

  it('edits a message and starts a thread on it', async () => {
    const client = new FakeClient();
    const channel = new FakeChannel();
    const handle = new FakeMessageHandle();
    channel.handles.set('m1', handle);
    client.channelsById.set('c1', channel);
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    await adapter.edit('discord:g:c1', 'm1', 'the reply');
    expect(handle.edited).toEqual(['the reply']);

    const threadId = await adapter.startThread('c1', 'm1', 'Topic');
    expect(threadId).toBe('thread-1');
    expect(handle.threads).toEqual(['Topic']);
  });

  it('disconnect stops sending', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();
    await adapter.disconnect();
    expect(client.destroyed).toBe(true);
    expect(adapter.isConnected()).toBe(false);
    await expect(adapter.send('discord:g:c', 'x')).rejects.toThrow(
      'not connected',
    );
  });

  it('normalizes a guild message; ignores bots and empty messages', () => {
    const normalized = normalizeDiscordMessage({
      id: 'm1',
      content: 'hi there',
      guildId: 'g',
      channelId: 'c',
      author: { id: 'u', bot: false },
      channel: { isTextBased: () => true, topic: '[icos-stream: chat]' },
      attachments: {
        map: (fn: (a: { url: string; name?: string }) => unknown) =>
          [{ url: 'https://x/y.png', name: 'y.png' }].map(fn),
      },
    });
    expect(normalized).toMatchObject({
      externalId: 'm1',
      guildId: 'g',
      isDm: false,
      isThread: false,
      parentChannelId: 'c',
      channelTopic: '[icos-stream: chat]',
      authorId: 'u',
      content: 'hi there',
    });
    expect(normalized?.attachments).toEqual([
      { url: 'https://x/y.png', name: 'y.png' },
    ]);

    expect(
      normalizeDiscordMessage({
        id: 'm2',
        content: 'from a bot',
        channelId: 'c',
        author: { id: 'b', bot: true },
      }),
    ).toBeNull();
    expect(
      normalizeDiscordMessage({
        id: 'm3',
        content: '',
        channelId: 'c',
        author: { id: 'u' },
        channel: { isTextBased: () => true },
      }),
    ).toBeNull();
  });

  it('maps a thread message to its parent and emits inbound to the handler', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    const received: DiscordInbound[] = [];
    adapter.onMessage((message) => received.push(message));

    await adapter.connect();
    client.emitReady();
    client.emit('messageCreate', {
      id: 'm9',
      content: 'in a thread',
      guildId: 'g',
      channelId: 't1',
      author: { id: 'u' },
      channel: {
        isTextBased: () => true,
        isThread: () => true,
        parentId: 'c1',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      externalId: 'm9',
      isThread: true,
      parentChannelId: 'c1',
      content: 'in a thread',
    });
  });

  it('fires onReady when ready, and immediately for a late registrant', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    let fired = 0;
    adapter.onReady(() => fired++);

    await adapter.connect();
    expect(fired).toBe(0);

    client.emitReady();
    expect(fired).toBe(1);

    // The client is already ready, so a later registrant fires at once.
    adapter.onReady(() => fired++);
    expect(fired).toBe(2);
  });

  it('resolves an explicit status channel id', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      { discordBotToken: 'tok', discordStatusChannelId: 's1' } as CoreConfig,
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    expect(adapter.statusTarget()).toBe('discord:status:s1');
  });

  it('finds the status channel by its topic marker', async () => {
    const client = new FakeClient();
    const status = new FakeChannel();
    status.id = 's2';
    status.topic = 'runtime status [icos-stream: status]';
    client.guilds.cache.set('g9', {
      id: 'g9',
      channels: { cache: new Map([['s2', status]]) },
    });
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    expect(adapter.statusTarget()).toBe('discord:g9:s2');
  });

  it('has no status target when none is configured', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    expect(adapter.statusTarget()).toBeNull();
  });

  it('runs the shutdown hook while still connected, before destroying', async () => {
    const client = new FakeClient();
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    const seen: boolean[] = [];
    adapter.onShutdown(async () => {
      seen.push(adapter.isConnected());
    });
    await adapter.onModuleDestroy();

    expect(seen).toEqual([true]);
    expect(client.destroyed).toBe(true);
  });

  it('splits a body over the Discord limit into sequential messages', async () => {
    const client = new FakeClient();
    const channel = new FakeChannel();
    client.channelsById.set('c1', channel);
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    const line = 'a'.repeat(1200);
    await adapter.send('discord:g:c1', `${line}\n${line}`);

    expect(channel.sent).toHaveLength(2);
    expect(channel.sent.every((m) => m.length <= 2000)).toBe(true);
    expect(channel.sent.join('')).toBe(`${line}\n${line}`);
  });

  it('edits the placeholder with the first chunk, then sends the overflow', async () => {
    const client = new FakeClient();
    const channel = new FakeChannel();
    const handle = new FakeMessageHandle();
    channel.handles.set('m1', handle);
    client.channelsById.set('c1', channel);
    const adapter = new DiscordAdapter(
      config('tok'),
      secrets,
      async () => client,
    );
    await adapter.connect();
    client.emitReady();

    const line = 'b'.repeat(1200);
    await adapter.edit('discord:g:c1', 'm1', `${line}\n${line}`);

    expect(handle.edited).toHaveLength(1);
    expect(handle.edited[0]?.length).toBeLessThanOrEqual(2000);
    expect(channel.sent).toHaveLength(1);
  });
});

describe('splitForDiscord', () => {
  it('passes a short body through unchanged', () => {
    expect(splitForDiscord('hello')).toEqual(['hello']);
  });

  it('splits at a newline and reassembles exactly', () => {
    const line = 'x'.repeat(1500);
    const text = `${line}\n${line}\n${line}`;
    const chunks = splitForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('falls back to a space, then a hard cut', () => {
    const words = Array.from({ length: 500 }, () => 'word').join(' ');
    const chunks = splitForDiscord(words, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe(words);

    const solid = 'z'.repeat(250);
    expect(splitForDiscord(solid, 100)).toEqual([
      'z'.repeat(100),
      'z'.repeat(100),
      'z'.repeat(50),
    ]);
  });
});
