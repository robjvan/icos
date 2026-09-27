import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';
import { TestClientController } from './test-client.controller';
import { ConversationModule } from './conversation/conversation.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [ConversationModule, RealtimeModule],
  controllers: [CoreController, TestClientController],
  providers: [CoreService],
})
export class CoreModule {}
