import type { CoreConfig } from '../config';
import type { ChannelSendService } from './channel-send.service';
import { ChannelToolSender } from './channel-tool-sender.service';

function setup(config: Partial<CoreConfig>): {
  sender: ChannelToolSender;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const send = {
    send: (input: Record<string, unknown>) => {
      calls.push(input);
      return Promise.resolve({ message: { id: 'm1' }, delivery: { id: 'd1' } });
    },
  } as unknown as ChannelSendService;
  return {
    sender: new ChannelToolSender(config as unknown as CoreConfig, send),
    calls,
  };
}

describe('ChannelToolSender', () => {
  it('resolves the operator to a DM and tags agent provenance', async () => {
    const { sender, calls } = setup({ discordAllowedUserIds: ['u1'] });

    const result = await sender.send({
      channel: 'discord',
      target: 'operator',
      body: 'hi',
    });

    expect(result).toEqual({ messageId: 'm1', deliveryId: 'd1' });
    expect(calls[0]).toMatchObject({
      channel: 'discord',
      conversationKey: 'discord:dm:u1',
      body: 'hi',
      provenance: { source: 'agent-tool' },
    });
  });

  it('rejects an unallowlisted channel target', async () => {
    const { sender } = setup({ discordAllowedChannelIds: ['c1'] });
    await expect(
      sender.send({
        channel: 'discord',
        target: 'channel',
        id: 'c2',
        body: 'x',
      }),
    ).rejects.toThrow('target_not_allowed');
  });

  it('rejects an unallowlisted user target', async () => {
    const { sender } = setup({ discordAllowedUserIds: ['u1'] });
    await expect(
      sender.send({ channel: 'discord', target: 'user', id: 'u2', body: 'x' }),
    ).rejects.toThrow('target_not_allowed');
  });

  it('sends to an allowlisted channel', async () => {
    const { sender, calls } = setup({ discordAllowedChannelIds: ['c1'] });
    await sender.send({
      channel: 'discord',
      target: 'channel',
      id: 'c1',
      body: 'x',
    });
    expect(calls[0]).toMatchObject({ conversationKey: 'discord:channel:c1' });
  });

  it('errors when no operator is allowlisted', async () => {
    const { sender } = setup({});
    await expect(
      sender.send({ channel: 'discord', target: 'operator', body: 'x' }),
    ).rejects.toThrow('no_operator_allowlisted');
  });
});
