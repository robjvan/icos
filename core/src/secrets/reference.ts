/**
 * Secret references (S3), pure and testable. A catalog or provider entry
 * never holds a secret value — it holds a reference that resolves at
 * spawn/request time:
 *   - `$VAR` / `${VAR}` → the process environment
 *   - `secret:NAME`     → the encrypted vault
 * Anything else is a literal and is rejected at validation time.
 */

export type SecretReference =
  { kind: 'env'; name: string } | { kind: 'vault'; name: string };

const ENV_BARE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_BRACED = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const VAULT = /^secret:([A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/;

/** Parse a reference; null means the value is a literal (rejected). */
export function parseSecretReference(value: string): SecretReference | null {
  const trimmed = value.trim();
  const env = ENV_BARE.exec(trimmed) ?? ENV_BRACED.exec(trimmed);
  if (env?.[1]) return { kind: 'env', name: env[1] };
  const vault = VAULT.exec(trimmed);
  if (vault?.[1]) return { kind: 'vault', name: vault[1] };
  return null;
}

/** Valid vault secret name (also used as the AES-GCM associated data). */
export function isValidSecretName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name);
}

/** Canonical catalog reference for a vault secret. */
export function vaultReference(name: string): string {
  return `secret:${name}`;
}
