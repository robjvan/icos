/* eslint-disable @typescript-eslint/require-await --
   async is required by the ChannelAdapter / discord.js-like contracts;
   the fake stubs are intentionally trivial. */
import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import type { DiscordChannelLike, DiscordClientLike } from './discord.adapter';
import {
  DiscordAdapter,
  normalizeDiscordMessage,
  parseDiscordTargetKey,
} from './discord.adapter';
import type { DiscordInbound } from './discord.types';

class FakeChannel implements DiscordChannelLike {
  readonly sent: string[] = [];
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
    expect(parseDiscordTargetKey('discord:g:c')).toBe('c');
    expect(parseDiscordTargetKey('discord:g:c:thread:t')).toBe('t');
    expect(parseDiscordTargetKey('discord:dm:u1')).toBeNull();
    expect(parseDiscordTargetKey('nope')).toBeNull();
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
});
