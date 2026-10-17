export type HealthCheckStatus = 'healthy' | 'degraded' | 'unknown';

/** Mirrors core `HealthCheck` (`core/src/health/health-report.ts`). */
export interface HealthCheck {
  readonly status: HealthCheckStatus;
  readonly detail: string;
}

/** Mirrors core `LlmHealthCheck`: config state + (FG9b) a live probe. */
export interface LlmHealthCheck extends HealthCheck {
  readonly provider: string;
  readonly model: string;
  /** Present when the endpoint was probed (FG9b). */
  readonly reachable?: boolean;
}

/** A probed LLM endpoint's reachability (FG9b). */
export interface ProviderReachability {
  readonly ok: boolean;
  readonly detail: string;
  readonly checkedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
}

/** Mirrors core `ProviderHealth`: ids/models/presence + reachability. */
export interface ProviderHealth {
  readonly source: 'catalog' | 'env';
  readonly active: { conversation: string; memory: string };
  readonly providers: {
    readonly id: string;
    readonly model: string;
    readonly enabled: boolean;
    readonly hasKey: boolean;
    readonly reachable?: boolean;
  }[];
  readonly reachability?: {
    readonly conversation?: ProviderReachability;
    readonly memory?: ProviderReachability;
  };
}

/** Mirrors core `GpuHealth`: null when the host has no NVIDIA GPU. */
export interface GpuHealth {
  readonly name: string;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly temperatureC: number | null;
}

/** Mirrors core `HostHealth`: every probe is best-effort, null when unavailable. */
export interface HostHealth {
  readonly os: string;
  readonly arch: string;
  readonly uptimeSeconds: number;
  readonly cpuCores: number;
  /** 0–100, or null when it cannot be measured. */
  readonly cpuPercent: number | null;
  readonly loadAverage: readonly [number, number, number];
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly gpu: GpuHealth | null;
}

/** Mirrors core `GET /core/health` response. */
export interface HealthResponse {
  readonly status: 'healthy' | 'degraded';
  readonly runtime: {
    readonly core: HealthCheck;
    readonly sessions: HealthCheck;
    readonly memory: HealthCheck;
    readonly llm: LlmHealthCheck;
  };
  /** Present when the provider registry is wired (FG9b). */
  readonly providers?: ProviderHealth;
  readonly host: HostHealth;
}
