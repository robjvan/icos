import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { CORE_CONFIG, coreConfigProvider } from '../config';
import type { CoreConfig } from '../config';
import {
  FileVaultSecretStore,
  loadMasterKey,
  vaultHasEntries,
} from './file-vault';
import { DisabledSecretStore, EnvSecretStore } from './secret-store';
import type { SecretStore } from './secret-store';
import { SecretChangeNotifier } from './secret-change.notifier';
import { SecretResolver, VAULT_STORE } from './secret-resolver';
import { SecretsController } from './secrets.controller';

/**
 * Resolve the vault from config (S3). No master key + empty vault →
 * a disabled store (UI-managed secrets off, env-only as before). No
 * master key + a non-empty vault → throw, so boot fails loudly rather
 * than silently ignoring stored secrets. A malformed key throws too.
 */
export function createVaultStore(config: CoreConfig): SecretStore {
  const path = config.vaultPath ?? join(config.authDirPath, 'secrets.vault');
  const key = loadMasterKey({
    ...(config.vaultKeyFile !== undefined
      ? { keyFile: config.vaultKeyFile }
      : {}),
    ...(config.vaultKey !== undefined ? { key: config.vaultKey } : {}),
  });
  if (!key) {
    if (vaultHasEntries(path)) {
      throw new Error(
        `secret vault at ${path} has entries but no master key is configured ` +
          `(set VAULT_KEY_FILE or VAULT_KEY)`,
      );
    }
    return new DisabledSecretStore();
  }
  return new FileVaultSecretStore(path, key);
}

/**
 * Secret store + management API (S3). Exports the resolver so catalogs
 * (MCP now, providers next) can resolve references at spawn/request
 * time. The vault is writable via the admin-only, write-only API.
 */
@Global()
@Module({
  controllers: [SecretsController],
  providers: [
    coreConfigProvider,
    {
      provide: VAULT_STORE,
      useFactory: createVaultStore,
      inject: [CORE_CONFIG],
    },
    { provide: EnvSecretStore, useFactory: () => new EnvSecretStore() },
    SecretResolver,
    SecretChangeNotifier,
  ],
  exports: [SecretResolver, VAULT_STORE, SecretChangeNotifier],
})
export class SecretsModule {}
