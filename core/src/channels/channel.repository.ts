import type {
  ChannelDelivery,
  ChannelDeliveryStatus,
  ChannelMessage,
  NewChannelDelivery,
  NewChannelMessage,
} from './channel.types';

/**
 * Boundary over the channel store. Persists the unified inbound/outbound
 * message ledger and the durable outbound delivery queue. The rest of
 * core depends on this interface, never on SQLite directly.
 */
export abstract class ChannelRepository {
  abstract recordMessage(input: NewChannelMessage): Promise<ChannelMessage>;

  abstract getMessage(id: string): Promise<ChannelMessage | null>;

  /** Inbound idempotency lookup: one transport id per channel. */
  abstract findMessageByExternalId(
    channel: string,
    externalId: string,
  ): Promise<ChannelMessage | null>;

  abstract listMessages(
    conversationKey: string,
    limit?: number,
  ): Promise<ChannelMessage[]>;

  abstract enqueueDelivery(input: NewChannelDelivery): Promise<ChannelDelivery>;

  abstract getDelivery(id: string): Promise<ChannelDelivery | null>;

  /**
   * Atomically claim the next due delivery (pending, or failed whose retry
   * is due) by marking it `sending` and incrementing its attempt count.
   * Returns null when nothing is due.
   */
  abstract claimDueDelivery(now: string): Promise<ChannelDelivery | null>;

  abstract markDeliverySent(
    id: string,
    externalMessageId: string | null,
  ): Promise<ChannelDelivery | null>;

  /**
   * Record a failed attempt. A non-null `nextAttemptAt` leaves the delivery
   * `failed` and due again later; null makes it terminal (`abandoned`).
   */
  abstract markDeliveryFailed(
    id: string,
    error: string,
    nextAttemptAt: string | null,
  ): Promise<ChannelDelivery | null>;

  abstract listDeliveries(
    status?: ChannelDeliveryStatus,
    limit?: number,
  ): Promise<ChannelDelivery[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
