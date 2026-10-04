import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { ConversationModule } from '../conversation/conversation.module';
import { ChannelsController } from './channels.controller';
import { ChannelsCoreModule } from './channels-core.module';
import { DiscordIngressService } from './discord-ingress.service';

/**
 * The channel subsystem's conversation-facing layer: the inbound ingress
 * (needs `ConversationService`) and the HTTP surface. Storage, outbound,
 * and adapters live in {@link ChannelsCoreModule} (no conversation
 * dependency), which the conversation layer also imports for the
 * `channel.send` port.
 */
@Module({
  imports: [ChannelsCoreModule, ConversationModule],
  controllers: [ChannelsController],
  providers: [coreConfigProvider, DiscordIngressService],
  exports: [ChannelsCoreModule, DiscordIngressService],
})
export class ChannelsModule {}
