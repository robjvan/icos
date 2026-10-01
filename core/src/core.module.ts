import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';
import { TestClientController } from './test-client.controller';
import { AuthModule } from './auth/auth.module';
import { ConversationModule } from './conversation/conversation.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SecretsModule } from './secrets/secrets.module';

@Module({
  imports: [AuthModule, SecretsModule, ConversationModule, RealtimeModule],
  controllers: [CoreController, TestClientController],
  providers: [CoreService],
})
export class CoreModule {}
