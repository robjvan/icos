import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { HostHealthProvider } from '../commands/host-health';
import { McpConnectionService } from '../mcp/mcp-connection.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { realtimeEvent } from '../realtime/realtime-event';
import { buildHealthReport } from './health-report';
import type { HealthReport } from './health-report';

/** Scheduler tick: re-evaluate the cheapest subscriber interval. */
const HEALTH_TICK_MS = 1000;

/**
 * Pollable system health for auxiliary surfaces (web-client footer).
 * Delegates to the shared builder so the endpoint and the `/health`
 * slash command always report the same data. Also drives the push
 * path: while ≥1 socket holds a health subscription, collect at the
 * fastest requested cadence and push — otherwise collect nothing
 * (subscriber gating, plan §10).
 *
 * NOTE: the gateway is attached late (post-`listen`, in `main.ts`), so
 * the service looks it up lazily instead of constructor-injecting it —
 * that keeps the DI graph acyclic (Gateway → nothing; Health → Gateway
 * would be a module cycle via ConversationModule ↔ RealtimeModule).
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPush = 0;

  constructor(
    private readonly sessions: SessionStore,
    private readonly candidates: MemoryCandidateRepository,
    private readonly host: HostHealthProvider,
    private readonly mcp: McpConnectionService,
    private readonly providers: ProviderRegistryService,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly modules: ModuleRef,
  ) {
    if (this.config.realtimeEnabled) {
      this.timer = setInterval(() => void this.tick(), HEALTH_TICK_MS);
      this.timer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  collect(): Promise<HealthReport> {
    return buildHealthReport({
      sessions: this.sessions,
      candidates: this.candidates,
      config: this.config,
      host: this.host,
      mcp: this.mcp,
      providers: this.providers,
    });
  }

  private async tick(): Promise<void> {
    let gateway: RealtimeGateway | null = null;
    try {
      gateway = this.modules.get(RealtimeGateway, { strict: false });
    } catch {
      return;
    }
    if (!gateway) return;
    const intervals = gateway.healthIntervals();
    if (intervals.length === 0) return;
    const fastest = Math.min(...intervals);
    const now = Date.now();
    if (now - this.lastPush < fastest) return;
    this.lastPush = now;
    try {
      const report = await this.collect();
      const event = realtimeEvent('health', {
        ...(report as unknown as Record<string, unknown>),
      });
      for (const socket of gateway.healthSockets()) {
        gateway.sendTo(socket, event);
      }
    } catch {
      // Best-effort: the next tick retries; polling covers the gap.
    }
  }
}
