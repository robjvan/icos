/* eslint-disable @typescript-eslint/require-await --
   async is required by the ChannelRepository / DiscordAdapter contracts;
   the fakes are intentionally trivial. */
import type { CoreConfig } from '../config';
import {
  ChannelPresenceService,
  DEFAULT_PRESENCE_OFFLINE,
  DEFAULT_PRESENCE_ONLINE,
} from './channel-presence.service';
import type { ChannelDeliveryService } from './channel-delivery.service';
import type { ChannelRepository } from './channel.repository';
import type { DiscordAdapter } from './discord.adapter';

function build(options: {
  target?: string | null;
  config?: Partial<CoreConfig>;
}): {
  service: ChannelPresenceService;
  adapter: { send: jest.Mock; statusTarget: jest.Mock };
  repository: { enqueueDelivery: jest.Mock };
  delivery: { runOnce: jest.Mock };
  readyHandlers: (() => void)[];
  shutdownHandlers: (() => Promise<void>)[];
} {
  const readyHandlers: (() => void)[] = [];
  const shutdownHandlers: (() => Promise<void>)[] = [];
  const adapter = {
    onReady: jest.fn((handler: () => void) => {
      readyHandlers.push(handler);
    }),
    onShutdown: jest.fn((handler: () => Promise<void>) => {
      shutdownHandlers.push(handler);
    }),
    statusTarget: jest.fn(() => options.target ?? null),
    send: jest.fn(async () => ({ externalMessageId: 'm1' })),
  };
  const repository = {
    enqueueDelivery: jest.fn(async () => ({ id: 'd1' })),
  };
  const delivery = { runOnce: jest.fn(async () => 1) };
  const service = new ChannelPresenceService(
    (options.config ?? {}) as CoreConfig,
    adapter as unknown as DiscordAdapter,
    repository as unknown as ChannelRepository,
    delivery as unknown as ChannelDeliveryService,
  );
  return {
    service,
    adapter,
    repository,
    delivery,
    readyHandlers,
    shutdownHandlers,
  };
}

describe('ChannelPresenceService', () => {
  it('registers ready and shutdown hooks on init', () => {
    const { service, readyHandlers, shutdownHandlers } = build({});

    service.onModuleInit();

    expect(readyHandlers).toHaveLength(1);
    expect(shutdownHandlers).toHaveLength(1);
  });

  it('enqueues the online message once and drains the queue', async () => {
    const { service, repository, delivery } = build({
      target: 'discord:g:s',
    });

    await service.announceOnline();
    await service.announceOnline(); // once per process start

    expect(repository.enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(repository.enqueueDelivery).toHaveBeenCalledWith({
      channel: 'discord',
      conversationKey: 'discord:g:s',
      body: DEFAULT_PRESENCE_ONLINE,
    });
    expect(delivery.runOnce).toHaveBeenCalledTimes(1);
  });

  it('honours a custom online template', async () => {
    const { service, repository } = build({
      target: 'discord:g:s',
      config: { discordPresenceOnline: 'back online' },
    });

    await service.announceOnline();

    expect(repository.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'back online' }),
    );
  });

  it('sends nothing when there is no status channel', async () => {
    const { service, repository, adapter } = build({ target: null });

    await service.announceOnline();
    await service.announceOffline();

    expect(repository.enqueueDelivery).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('is silent when disabled', async () => {
    const { service, repository, adapter } = build({
      target: 'discord:g:s',
      config: { discordPresenceEnabled: false },
    });

    await service.announceOnline();
    await service.announceOffline();

    expect(repository.enqueueDelivery).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('sends the offline message directly on shutdown', async () => {
    const { service, adapter } = build({ target: 'discord:g:s' });

    await service.announceOffline();

    expect(adapter.send).toHaveBeenCalledWith(
      'discord:g:s',
      DEFAULT_PRESENCE_OFFLINE,
    );
  });

  it('honours a custom offline template', async () => {
    const { service, adapter } = build({
      target: 'discord:g:s',
      config: { discordPresenceOffline: 'going down' },
    });

    await service.announceOffline();

    expect(adapter.send).toHaveBeenCalledWith('discord:g:s', 'going down');
  });

  it('announces when invoked through the registered ready hook', async () => {
    const { service, repository, readyHandlers } = build({
      target: 'discord:g:s',
    });
    service.onModuleInit();

    readyHandlers[0]?.();
    for (
      let i = 0;
      i < 20 && repository.enqueueDelivery.mock.calls.length === 0;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(repository.enqueueDelivery).toHaveBeenCalledTimes(1);
  });
});
