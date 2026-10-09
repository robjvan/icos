import type { ToolDescriptor } from './tool-registry';

/**
 * Enablement policy for the tool surface (M17a). Resolved from config now,
 * and per-session later (skills, tools, and security all want a session-scoped
 * capability boundary — so this stays a pure function the caller can feed from
 * any source).
 */
export interface ToolPolicyConfig {
  /** When non-empty, only these toolsets are enabled (opt-in). */
  enabledToolsets?: readonly string[];
  /** Always-disabled toolsets. */
  disabledToolsets?: readonly string[];
  /** Per-tool overrides; an explicit enable wins over a disable. */
  enabledTools?: readonly string[];
  disabledTools?: readonly string[];
}

export interface ResolvedToolPolicy {
  /** Tools offered to the model this turn. */
  offered: readonly ToolDescriptor[];
  /** Known but not offered; declared in the planning frame, never silent. */
  disabled: readonly ToolDescriptor[];
}

/**
 * Resolve which tools are offered. Default is **opt-out**: every toolset is
 * enabled unless `enabledToolsets` is non-empty (then it is opt-in). Explicit
 * per-tool enables win over disables, so a single tool can be re-enabled
 * inside an otherwise-disabled toolset.
 */
export function resolveToolPolicy(
  descriptors: readonly ToolDescriptor[],
  policy: ToolPolicyConfig = {},
): ResolvedToolPolicy {
  const enabledToolsets = new Set(policy.enabledToolsets ?? []);
  const disabledToolsets = new Set(policy.disabledToolsets ?? []);
  const enabledTools = new Set(policy.enabledTools ?? []);
  const disabledTools = new Set(policy.disabledTools ?? []);
  const offered: ToolDescriptor[] = [];
  const disabled: ToolDescriptor[] = [];
  for (const descriptor of descriptors) {
    let on =
      enabledToolsets.size === 0 || enabledToolsets.has(descriptor.toolset);
    if (disabledToolsets.has(descriptor.toolset)) on = false;
    if (disabledTools.has(descriptor.name)) on = false;
    if (enabledTools.has(descriptor.name)) on = true;
    (on ? offered : disabled).push(descriptor);
  }
  return { offered, disabled };
}
