import { Inject, Injectable } from '@nestjs/common';
import { parseSecretReference } from './reference';
import { EnvSecretStore } from './secret-store';
import type { SecretStore } from './secret-store';

/** DI token for the encrypted vault store (the writable SecretStore). */
export const VAULT_STORE = 'VAULT_STORE';

/**
 * Resolves a secret reference to its value (S3), on demand — never
 * cached. `$VAR` reads the process environment; `secret:NAME` reads
 * the vault. Consumers call this at spawn/request time so rotation and
 * deletion take effect immediately and a missing value fails closed.
 */
@Injectable()
export class SecretResolver {
  private readonly env: EnvSecretStore;

  constructor(
    @Inject(VAULT_STORE) private readonly vault: SecretStore,
    env?: EnvSecretStore,
  ) {
    this.env = env ?? new EnvSecretStore();
  }

  /** The vault (for the API + dependency checks). */
  get store(): SecretStore {
    return this.vault;
  }

  /** Resolve a reference string, or null when it is missing/invalid. */
  resolve(reference: string): string | null {
    const parsed = parseSecretReference(reference);
    if (!parsed) return null;
    return parsed.kind === 'vault'
      ? this.vault.get(parsed.name)
      : this.env.get(parsed.name);
  }
}
