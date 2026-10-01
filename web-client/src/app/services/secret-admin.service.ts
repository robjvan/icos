import { Injectable, inject } from '@angular/core';
import { SECRETS_ENDPOINT, SECURITY_ENDPOINT } from '../../constants';
import { CoreApiService } from './core-api.service';

export interface SecretMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretList {
  secrets: SecretMetadata[];
  writable: boolean;
}

/**
 * Secret vault management (S5). Write-only by contract: values go in,
 * metadata (never a value) comes back.
 */
@Injectable({ providedIn: 'root' })
export class SecretAdminService {
  private readonly api = inject(CoreApiService);

  list(): Promise<SecretList> {
    return this.api.get<SecretList>(SECRETS_ENDPOINT);
  }

  put(name: string, value: string): Promise<SecretMetadata> {
    return this.api.put<SecretMetadata>(
      `${SECRETS_ENDPOINT}/${encodeURIComponent(name)}`,
      { value },
    );
  }

  remove(name: string): Promise<{ deleted: boolean }> {
    return this.api.delete<{ deleted: boolean }>(
      `${SECRETS_ENDPOINT}/${encodeURIComponent(name)}`,
    );
  }
}

export interface SecurityStatus {
  host: string;
  port: number;
  loopback: boolean;
  authEnabled: boolean;
  exposeAcknowledged: boolean;
  corsAllowedOrigins: string[];
}

/** Exposure posture (S5) for the warning banner. */
@Injectable({ providedIn: 'root' })
export class SecurityStatusService {
  private readonly api = inject(CoreApiService);

  status(): Promise<SecurityStatus> {
    return this.api.get<SecurityStatus>(`${SECURITY_ENDPOINT}/status`);
  }
}
