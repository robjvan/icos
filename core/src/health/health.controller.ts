import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type { HealthReport } from './health-report';
import { Public } from '../auth/decorators';

/**
 * Pollable system health for auxiliary surfaces (web-client footer).
 * Same data as the `/health` slash command, without a conversation turn.
 * The full report is authenticated (it discloses host details); only the
 * liveness route below is public, for container/workload probes.
 */
@Controller('core/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Unauthenticated liveness only — no host or runtime detail. */
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get()
  async collect(): Promise<HealthReport> {
    return this.health.collect();
  }
}
