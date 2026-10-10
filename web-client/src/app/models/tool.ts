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
