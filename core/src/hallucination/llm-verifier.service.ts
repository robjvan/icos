import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { LlmEndpointConfig } from '../llm/llm.client';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { describeAssertion } from './hallucination.types';
import type {
  VerificationRequest,
  VerificationVerdict,
  VerificationVerdictLabel,
} from './hallucination.types';
import { independenceOf, unavailable } from './verification.support';

export const VERIFICATION_CLIENT_FACTORY = 'VERIFICATION_CLIENT_FACTORY';

export interface VerificationChatClient {
  chat(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  }): Promise<{ content: string; model: string }>;
}

export type VerificationClientFactory = (
  endpoint: LlmEndpointConfig,
) => VerificationChatClient;

const SYSTEM_PROMPT =
  'You verify a claim against evidence. Reply with exactly one word: SUPPORTED, CONTRADICTED, or UNKNOWN.';

/**
 * LLM verifier (M15.5c, fallback tier). Uses an OpenAI-compatible provider
 * from the S4 catalog, named by `HALLUCINATION_VERIFIER_PROVIDER` — a
 * second chat model (e.g. a small local qwen) that judges the claim. If it
 * is the same model that spoke, the verdict is recorded as `self` (self-
 * consistency), never as independent verification.
 */
@Injectable()
export class LlmVerifier {
  private readonly logger = new Logger(LlmVerifier.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly registry: ProviderRegistryService,
    @Inject(VERIFICATION_CLIENT_FACTORY)
    private readonly makeClient: VerificationClientFactory,
  ) {}

  isConfigured(): boolean {
    return this.endpoint() !== null;
  }

  private endpoint(): LlmEndpointConfig | null {
    const id = (this.config.hallucinationVerifierProvider ?? '').trim();
    return id ? this.registry.endpointForId(id) : null;
  }

  async verify(request: VerificationRequest): Promise<VerificationVerdict> {
    const endpoint = this.endpoint();
    if (!endpoint) {
      return unavailable('llm', 'no verifier provider configured');
    }
    try {
      const client = this.makeClient(endpoint);
      const result = await client.chat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Claim: ${describeAssertion(request.assertion)}\nEvidence: ${request.evidenceSummary}`,
          },
        ],
      });
      return {
        available: true,
        backend: 'llm',
        verdict: parseLabel(result.content),
        probability: null,
        model: endpoint.llmModel,
        independence: independenceOf(request.speakerModel, endpoint.llmModel),
      };
    } catch (error) {
      this.logger.warn(
        `LLM verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return unavailable(
        'llm',
        error instanceof Error ? error.message : 'request failed',
      );
    }
  }
}

/** Parse a one-word verdict, tolerant of surrounding prose. */
export function parseLabel(content: string): VerificationVerdictLabel {
  const match = content
    .toUpperCase()
    .match(/\b(SUPPORTED|CONTRADICTED|UNKNOWN)\b/);
  if (match?.[1] === 'SUPPORTED') return 'supported';
  if (match?.[1] === 'CONTRADICTED') return 'contradicted';
  return 'unknown';
}
