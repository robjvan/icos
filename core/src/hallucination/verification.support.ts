import type {
  VerificationBackend,
  VerificationIndependence,
  VerificationVerdict,
} from './hallucination.types';

/** A failed/unavailable verdict. `backend: null` means "no tier ran". */
export function unavailable(
  backend: VerificationBackend | null,
  detail?: string,
): VerificationVerdict {
  return {
    available: false,
    backend,
    verdict: 'unknown',
    probability: null,
    model: null,
    independence: 'unknown',
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Whether the verifier is independent from the speaker. A match is
 * self-consistency, never independent verification — recorded, not hidden.
 */
export function independenceOf(
  speakerModel: string | undefined,
  verifierModel: string | null,
): VerificationIndependence {
  const speaker = (speakerModel ?? '').trim();
  const verifier = (verifierModel ?? '').trim();
  if (!speaker || !verifier) return 'unknown';
  return speaker === verifier ? 'self' : 'independent';
}
