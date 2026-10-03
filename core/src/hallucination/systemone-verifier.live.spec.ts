import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import { SystemoneVerifier } from './systemone-verifier.service';

/**
 * Live check against a running systemone verifier (M15.5c/e). Skipped
 * unless `JEV_LIVE_URL` is set, e.g.:
 *
 *   JEV_LIVE_URL=http://127.0.0.1:8765 npx jest systemone-verifier.live
 *
 * Start one with `bin/verifier` (macOS: MLX on the host).
 */
const LIVE_URL = process.env['JEV_LIVE_URL'];
const maybe = LIVE_URL ? describe : describe.skip;

maybe('SystemoneVerifier (live)', () => {
  it('maps a real decision-model verdict through our client', async () => {
    const config = {
      hallucinationDecisionUrl: LIVE_URL,
      hallucinationVerifierTimeoutMs: 20000,
    } as unknown as CoreConfig;
    const verifier = new SystemoneVerifier(
      config,
      { resolve: () => null } as unknown as SecretResolver,
      fetch,
    );

    const verdict = await verifier.verify({
      assertion: { subject: 'user', predicate: 'prefers', object: 'oak' },
      evidenceSummary:
        'the store holds the opposing claim (negated) at confidence 0.90',
      speakerModel: 'gemma4',
    });

    expect(verdict.available).toBe(true);
    expect(verdict.backend).toBe('decision');
    expect(['supported', 'contradicted', 'unknown']).toContain(verdict.verdict);
    expect(verdict.model).toContain('jev-style');
    expect(verdict.independence).toBe('independent');
    expect(verdict.probability).toBeGreaterThan(0);
  }, 60000);
});
