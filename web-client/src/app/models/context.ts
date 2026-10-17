/** Where the resolved context window came from (FG6). */
export type ContextWindowSource = 'provider' | 'env' | 'probe' | 'default';

/** Resolved context budget (M20.6). Mirrors the core `ContextSettings`. */
export interface ContextSettings {
  contextWindow: number;
  contextWindowSource: ContextWindowSource;
  maxOutputTokens: number;
  usableTokens: number;
  triggerTokens: number;
  target: number;
  enabled: boolean;
}

/** A session's rolling compaction summary (M20.6.2). */
export interface ContextSummary {
  sessionId: string;
  summary: string;
  coveredUptoMessageId: number;
  tokenEstimate: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContextSettingsResponse {
  settings: ContextSettings;
}

export interface ContextSummaryResponse {
  sessionId: string;
  summary: ContextSummary | null;
  settings: ContextSettings;
}
