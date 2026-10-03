import { Controller, Get } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import type { ChannelHealth } from './channel-adapter';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';

/**
 * Channel status surface (M16). Read-only, admin-only: adapter health and
 * outbound queue depth. Never exposes tokens or message bodies.
 */
@Controller('core/channels')
export class ChannelsController {
  constructor(
    private readonly delivery: ChannelDeliveryService,
    private readonly repository: ChannelRepository,
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
}
