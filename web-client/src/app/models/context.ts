/** Resolved context budget (M20.6). Mirrors the core `ContextSettings`. */
export interface ContextSettings {
  contextWindow: number;
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
