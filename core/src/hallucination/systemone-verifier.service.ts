import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SecretResolver } from '../secrets/secret-resolver';
import { describeAssertion } from './hallucination.types';
import type {
  VerificationRequest,
  VerificationVerdict,
  VerificationVerdictLabel,
} from './hallucination.types';
import { independenceOf, unavailable } from './verification.support';

export const SYSTEMONE_FETCH = 'SYSTEMONE_FETCH';
export type SystemoneFetch = typeof fetch;

interface SystemoneAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface SystemoneResponse {
  model?: string;
  answers?: Record<string, SystemoneAnswer>;
}

/**
 * Systemone decision verifier (M15.5c, preferred tier).
 *
 * Speaks the public `POST /v1/systemone` contract — the same client works
 * for a local Jev model and for any Jev-compatible server, so "local vs
 * cloud decision model" is a different `HALLUCINATION_DECISION_URL`, not a
 * different code path. It asks one typed `choice` question and maps the
 * calibrated probabilities to a verdict. Fails closed (unavailable) on any
 * error, so the tier below takes over.
 */
@Injectable()
export class SystemoneVerifier {
  private readonly logger = new Logger(SystemoneVerifier.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly secrets: SecretResolver,
    @Inject(SYSTEMONE_FETCH) private readonly http: SystemoneFetch,
  ) {}

  isConfigured(): boolean {
    return (this.config.hallucinationDecisionUrl ?? '').length > 0;
  }

  async verify(request: VerificationRequest): Promise<VerificationVerdict> {
    const baseUrl = this.config.hallucinationDecisionUrl;
    if (!baseUrl) {
      return unavailable('decision', 'no decision endpoint configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.hallucinationVerifierTimeoutMs ?? 10000,
    );
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      const keyRef = this.config.hallucinationDecisionApiKeyRef;
      if (keyRef) {
        const key = this.secrets.resolve(keyRef);
        if (key) headers['authorization'] = `Bearer ${key}`;
      }
      const response = await this.http(`${baseUrl}/v1/systemone`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          state: `Claim: ${describeAssertion(request.assertion)}\nEvidence: ${request.evidenceSummary}`,
          questions: {
            verdict: {
              type: 'choice',
              instructions:
                'Given the evidence, is the claim supported, contradicted, or neither?',
              criteria: {
                supported: 'The evidence supports the claim.',
                contradicted: 'The evidence contradicts the claim.',
                unknown:
                  'The evidence neither supports nor contradicts the claim.',
              },
            },
          },
        }),
      });
      if (!response.ok) {
        return unavailable('decision', `HTTP ${response.status}`);
      }
      const body = (await response.json()) as SystemoneResponse;
      const answer = body.answers?.['verdict'];
      const choice = answer?.choice;
      const verdict: VerificationVerdictLabel =
        choice === 'supported' ||
        choice === 'contradicted' ||
        choice === 'unknown'
          ? choice
          : 'unknown';
      const model = typeof body.model === 'string' ? body.model : null;
      return {
        available: true,
        backend: 'decision',
        verdict,
        probability:
          (choice ? answer?.probabilities?.[choice] : undefined) ??
          answer?.confidence ??
          null,
        model,
        independence: independenceOf(request.speakerModel, model),
      };
    } catch (error) {
      this.logger.warn(
        `Decision verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return unavailable(
        'decision',
        error instanceof Error ? error.message : 'request failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
