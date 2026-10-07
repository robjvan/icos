import { Injectable } from '@nestjs/common';
import { LlmClient } from './llm.client';
import type { LlmEndpointConfig } from './llm.client';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import {
  conversationEndpointConfig,
  memoryEndpointConfig,
} from '../providers/provider-registry.service';
import { MEMORY_LLM_CLIENT } from '../memory/llm-memory-candidate-extractor';
import { VISION_LLM_CLIENT } from '../vision/vision.service';

export { conversationEndpointConfig, memoryEndpointConfig };

/**
 * Conversation role (S4): follows the active provider from the registry,
 * re-resolving the endpoint on every request so a reload, a switched
 * provider, or a rotated key takes effect without a restart. Falls back
 * to the env `LLM_*` endpoint when no catalog entry is active.
 */
@Injectable()
export class ConversationLlmClient extends LlmClient {
  constructor(private readonly registry: ProviderRegistryService) {
    super(registry.conversationEndpoint());
  }

  protected override endpoint(): LlmEndpointConfig {
    return this.registry.conversationEndpoint();
  }
}

/**
 * Memory/extraction role: same routing, its own active provider and env
 * fallback (`MEMORY_LLM_*`), so the two roles never share a provider
 * unless configured to.
 */
@Injectable()
export class MemoryLlmClient extends LlmClient {
  constructor(private readonly registry: ProviderRegistryService) {
    super(registry.memoryEndpoint());
  }

  protected override endpoint(): LlmEndpointConfig {
    return this.registry.memoryEndpoint();
  }
}

export const conversationLlmClientProvider = {
  provide: LlmClient,
  useFactory: (registry: ProviderRegistryService): LlmClient =>
    new ConversationLlmClient(registry),
  inject: [ProviderRegistryService],
};

export const memoryLlmClientProvider = {
  provide: MEMORY_LLM_CLIENT,
  useFactory: (registry: ProviderRegistryService): LlmClient =>
    new MemoryLlmClient(registry),
  inject: [ProviderRegistryService],
};

/**
 * Vision role (M17b.8): an auxiliary image-capable model that answers
 * `vision_analyze`. Env-configured (`VISION_LLM_*`) with fallback to the
 * memory then conversation endpoint.
 */
@Injectable()
export class VisionLlmClient extends LlmClient {
  constructor(private readonly registry: ProviderRegistryService) {
    super(registry.visionEndpoint());
  }

  protected override endpoint(): LlmEndpointConfig {
    return this.registry.visionEndpoint();
  }
}

export const visionLlmClientProvider = {
  provide: VISION_LLM_CLIENT,
  useFactory: (registry: ProviderRegistryService): LlmClient =>
    new VisionLlmClient(registry),
  inject: [ProviderRegistryService],
};
