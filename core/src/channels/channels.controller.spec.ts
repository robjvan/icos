import type { CoreConfig } from '../config';
import { ChannelsController } from './channels.controller';
import type { ChannelDeliveryService } from './channel-delivery.service';
import type { ChannelRepository } from './channel.repository';
import type { ChannelSendService } from './channel-send.service';

function build(overrides: Partial<CoreConfig>): ChannelsController {
  const delivery = {
    health: jest.fn(() => [{ channel: 'discord' as const, connected: true }]),
  } as unknown as ChannelDeliveryService;
  const repository = {
    listDeliveries: jest.fn(() => Promise.resolve([])),
  } as unknown as ChannelRepository;
  const send = {} as unknown as ChannelSendService;
  return new ChannelsController(
    delivery,
    repository,
    send,
    overrides as CoreConfig,
  );
}

describe('ChannelsController', () => {
  it('summarises the resolved accept policy', async () => {
    const controller = build({
      discordAllowDirectMessages: false,
      discordAllowedChannelIds: ['c1', 'c2'],
      discordAllowedUserIds: ['u1'],
      discordAllowedGuildIds: ['g1'],
    });

    const status = await controller.status();

    expect(status.policy).toEqual({
      allowDirectMessages: false,
      allowedChannels: 2,
      allowedUsers: 1,
      allowedGuilds: 1,
    });
    expect(status.channels).toEqual([{ channel: 'discord', connected: true }]);
  });

  it('treats absent lists as empty and DMs as allowed by default', async () => {
    const controller = build({});

    const status = await controller.status();

    expect(status.policy).toEqual({
      allowDirectMessages: true,
      allowedChannels: 0,
      allowedUsers: 0,
      allowedGuilds: 0,
    });
  });
});
