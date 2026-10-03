/**
 * M16e.2: the port the tool executor uses to send an outbound message. It
 * keeps the `tools` layer decoupled from the channel implementation — the
 * tools module depends on this interface, and the channels module provides
 * the implementation (which resolves the target against the allowlist).
 */
export const CHANNEL_SEND = 'CHANNEL_SEND';

/** A normalized channel-send request (resolved by the provider). */
export interface ChannelSendRequest {
  channel: 'discord' | 'email';
  target: 'operator' | 'channel' | 'user';
  id?: string;
  body: string;
}

export interface ChannelSendPort {
  send(
    request: ChannelSendRequest,
  ): Promise<{ messageId: string; deliveryId: string }>;
}
