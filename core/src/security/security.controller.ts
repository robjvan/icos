import { Controller, Get, Inject } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { RequireRole } from '../auth/decorators';
import { isLoopbackHost, isRunningInContainer } from './security-posture';

/** Operator-visible exposure posture (S5) — no secrets, no host internals. */
export interface SecurityStatus {
  host: string;
  port: number;
  loopback: boolean;
  authEnabled: boolean;
  exposeAcknowledged: boolean;
  corsAllowedOrigins: string[];
}

/**
 * Security posture for the management UI (S5): lets the frontend show a
 * clear "you are exposing this instance" warning for non-loopback binds.
 * Admin-only.
 */
@Controller('core/security')
export class SecurityController {
  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  @RequireRole('admin')
  @Get('status')
  status(): SecurityStatus {
    return {
      host: this.config.host,
      port: this.config.port,
      loopback: isLoopbackHost(this.config.host),
      authEnabled: this.config.authEnabled,
      exposeAcknowledged: this.config.exposeAcknowledged,
      corsAllowedOrigins: this.config.corsAllowedOrigins,
    };
  }
}

/** Container check for the (non-API) boot posture path. */
export function runningInContainer(): boolean {
  return isRunningInContainer(process.env, existsSync);
}
