/* eslint-disable @typescript-eslint/require-await --
   async is required by the ChannelAdapter / discord.js-like contracts;
   the fake stubs are intentionally trivial. */
import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import type { DiscordChannelLike, DiscordClientLike } from './discord.adapter';
import { DiscordAdapter, parseDiscordTargetKey } from './discord.adapter';

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

  on(): unknown {
    return this;
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
});
