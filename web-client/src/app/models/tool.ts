export type ToolApprovalPolicy = 'none' | 'required';

/** One entry from `GET /core/tools/inventory` (M20f). */
export interface ToolInventoryEntry {
  readonly name: string;
  readonly toolset: string;
  readonly description: string;
  /** Declared approval policy. */
  readonly approval: ToolApprovalPolicy;
  /** Global auto-approve override in effect for this tool. */
  readonly autoApprove: boolean;
}

export interface ToolInventoryResponse {
  readonly tools: ToolInventoryEntry[];
}

/** Tool-discovery state + bounds from `GET /core/tools/discovery` (M20.7). */
export interface ToolDiscoveryState {
  readonly enabled: boolean;
  readonly universe: number;
  readonly bounds: {
    readonly maxPerTurn: number;
    readonly discoveryLimit: number;
    readonly pullMaxResults: number;
    readonly pullMaxPerTurn: number;
    readonly alwaysOn: readonly string[];
  };
}
