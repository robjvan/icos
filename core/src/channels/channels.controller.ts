import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import type { ChannelHealth } from './channel-adapter';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import { ChannelSendService } from './channel-send.service';
import { ChannelSendMessageDto } from './dto/send-message.dto';

/**
 * Channel surface (M16). Read-only status plus, from M16e, an operator
 * outbound send. Admin-only; never exposes tokens or message bodies.
 */
@Controller('core/channels')
export class ChannelsController {
  constructor(
    private readonly delivery: ChannelDeliveryService,
    private readonly repository: ChannelRepository,
    private readonly send: ChannelSendService,
  ) {}

  @RequireRole('admin')
  @Get()
  async status(): Promise<{
    channels: ChannelHealth[];
    deliveries: { pending: number; retrying: number };
  }> {
    const pending = await this.repository.listDeliveries('pending', 200);
    const retrying = await this.repository.listDeliveries('failed', 200);
    return {
      channels: this.delivery.health(),
      deliveries: { pending: pending.length, retrying: retrying.length },
    };
  }

  /**
   * M16e: queue an outbound message. Admin-only — the operator is trusted,
   * so any well-formed target is allowed (the agent tool is the path that
   * constrains to the allowlist). Returns the recorded message + delivery.
   */
  @RequireRole('admin')
  @Post('messages')
  @HttpCode(202)
  async sendMessage(@Body() dto: ChannelSendMessageDto): Promise<{
    messageId: string;
    deliveryId: string;
    status: string;
  }> {
    const { message, delivery } = await this.send.send({
      channel: dto.channel,
      conversationKey: dto.conversationKey,
      body: dto.body,
    });
    return {
      messageId: message.id,
      deliveryId: delivery.id,
      status: delivery.status,
    };
  }
}
