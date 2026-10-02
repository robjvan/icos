import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';
import { TestClientController } from './test-client.controller';
import { AuthModule } from './auth/auth.module';
import { ConversationModule } from './conversation/conversation.module';
import { PersonaModule } from './persona/persona.module';
import { ProvidersModule } from './providers/providers.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SecretsModule } from './secrets/secrets.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    AuthModule,
    SecurityModule,
    SecretsModule,
    ProvidersModule,
    ConversationModule,
    PersonaModule,
    RealtimeModule,
  ],
  controllers: [CoreController, TestClientController],
  providers: [CoreService],
})
export class CoreModule {}
