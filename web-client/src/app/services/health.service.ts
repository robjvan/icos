import { Injectable, inject, signal } from '@angular/core';
import { HEALTH_ENDPOINT } from '../../constants';
import type { HealthResponse } from '../models/health';
import { CoreApiService } from './core-api.service';

/** Default footer health poll interval (seconds). */
export const DEFAULT_HEALTH_POLL_SECONDS = 5;
/** Minimum footer health poll interval (seconds). */
export const MIN_HEALTH_POLL_SECONDS = 1;
/** Maximum footer health poll interval (seconds). */
export const MAX_HEALTH_POLL_SECONDS = 30;

const HEALTH_POLL_STORAGE_KEY = 'icos-health-poll-seconds';

function readStoredPollInterval(): number {
  try {
    const raw = localStorage.getItem(HEALTH_POLL_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_HEALTH_POLL_SECONDS;
    }
    return clampPollInterval(Number(raw));
  } catch {
    return DEFAULT_HEALTH_POLL_SECONDS;
  }
}

function clampPollInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_HEALTH_POLL_SECONDS;
  }
  return Math.min(
    MAX_HEALTH_POLL_SECONDS,
    Math.max(MIN_HEALTH_POLL_SECONDS, Math.round(value)),
  );
}

/** Guard a pushed payload: it must look like a `HealthResponse`. */
function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Record<string, unknown>;
  if (typeof report['status'] !== 'string') return false;
  if (typeof report['runtime'] !== 'object' || report['runtime'] === null) {
    return false;
  }
  if (typeof report['host'] !== 'object' || report['host'] === null) {
    return false;
  }
  const host = report['host'] as Record<string, unknown>;
  return (
    typeof host['os'] === 'string' &&
    typeof host['memoryUsedBytes'] === 'number' &&
    typeof host['memoryTotalBytes'] === 'number'
  );
}

/** RAM usage percent from a health payload, one-decimal precision. */
export function ramPercent(health: HealthResponse): number {
  const { memoryUsedBytes, memoryTotalBytes } = health.host;
  if (memoryTotalBytes <= 0) {
    return 0;
  }
  return (
    Math.round((memoryUsedBytes / memoryTotalBytes) * 1000) / 10
  );
}

/**
 * Pollable system health for the footer status bar.
 * Auxiliary surface: failures degrade to the `error` signal and never
 * break chat. Poll scheduling lives in the consumer (footer) so the
 * interval slider can restart it; this service owns fetch + state.
 */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(CoreApiService);

  readonly health = signal<HealthResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly pollIntervalSeconds = signal<number>(readStoredPollInterval());

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.api.get<HealthResponse>(HEALTH_ENDPOINT);
      this.health.set(data);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Apply a server-pushed health report (the one state-carrying event,
   * per D2). Same validation as a fetch: the payload must look like a
   * `HealthResponse` or it is ignored — the socket never becomes a
   * second source of truth.
   */
  applyPush(payload: Record<string, unknown> | undefined): void {
    if (!isHealthResponse(payload)) return;
    this.error.set(null);
    this.health.set(payload);
  }

  setPollInterval(seconds: number): void {
    const next = clampPollInterval(seconds);
    this.pollIntervalSeconds.set(next);
    try {
      localStorage.setItem(HEALTH_POLL_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable; interval still applies in-memory.
    }
  }
}
