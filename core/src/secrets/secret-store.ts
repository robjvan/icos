/**
 * SecretStore boundary (S3). Two adapters satisfy it:
 *   - `EnvSecretStore`   — read-only view of the process environment
 *   - `FileVaultSecretStore` — encrypted, UI-writable (see file-vault.ts)
 * A `DisabledSecretStore` stands in when no master key is configured.
 * `list()` is always metadata only — values never cross this boundary
 * outward.
 */

export interface SecretMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretStore {
  /** True when `put`/`delete` are permitted. */
  readonly writable: boolean;
  has(name: string): boolean;
  /** Resolve a value (internal use only — never returned over HTTP). */
  get(name: string): string | null;
  put(name: string, value: string): SecretMetadata;
  delete(name: string): boolean;
  /** Metadata for every stored secret; never values. */
  list(): SecretMetadata[];
}

/** Read-only adapter over a process environment. */
export class EnvSecretStore implements SecretStore {
  readonly writable = false;

  constructor(private readonly source: NodeJS.ProcessEnv = process.env) {}

  has(name: string): boolean {
    const value = this.source[name];
    return typeof value === 'string' && value !== '';
  }

  get(name: string): string | null {
    const value = this.source[name];
    return typeof value === 'string' && value !== '' ? value : null;
  }

  put(_name: string, _value: string): SecretMetadata {
    void _name;
    void _value;
    throw new Error('EnvSecretStore is read-only');
  }

  delete(_name: string): boolean {
    void _name;
    throw new Error('EnvSecretStore is read-only');
  }

  /** Never enumerate the environment (names can be sensitive too). */
  list(): SecretMetadata[] {
    return [];
  }
}

/** Stand-in when no master key is configured: reads miss, writes refuse. */
export class DisabledSecretStore implements SecretStore {
  readonly writable = false;

  has(_name: string): boolean {
    void _name;
    return false;
  }

  get(_name: string): string | null {
    void _name;
    return null;
  }

  put(_name: string, _value: string): SecretMetadata {
    void _name;
    void _value;
    throw new Error(
      'secret vault disabled: set VAULT_KEY_FILE (or VAULT_KEY) to enable it',
    );
  }

  delete(_name: string): boolean {
    void _name;
    throw new Error(
      'secret vault disabled: set VAULT_KEY_FILE (or VAULT_KEY) to enable it',
    );
  }

  list(): SecretMetadata[] {
    return [];
  }
}
