import { Global, Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { ProviderRegistryService } from './provider-registry.service';
import { ProvidersController } from './providers.controller';

/**
 * LLM provider registry (S4). Global so the LLM client providers and the
 * health surface can resolve the active provider without every module
 * importing this one. Reads endpoints on demand (no restart needed).
 */
@Global()
@Module({
  controllers: [ProvidersController],
  providers: [coreConfigProvider, ProviderRegistryService],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}
