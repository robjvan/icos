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
  /**
   * Selector aliases (M19). A selector token matches its own toolset plus any
   * toolset listed here. Generated MCP toolsets alias both ways: the bare
   * server name (`github` → `mcp-github`) and `mcp` → every `mcp-<server>`.
   * Aliases are **additive**, so a name shared with a built-in toolset (e.g.
   * `browser` → `mcp-browser`) selects both — composition, never shadowing.
   */
  toolsetAliases?: Readonly<Record<string, readonly string[]>>;
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
 * inside an otherwise-disabled toolset. Selectors are expanded through
 * `toolsetAliases` first (M19), so aliases compose with the literal names.
 */
export function resolveToolPolicy(
  descriptors: readonly ToolDescriptor[],
  policy: ToolPolicyConfig = {},
): ResolvedToolPolicy {
  const aliases = policy.toolsetAliases ?? {};
  const expand = (selectors: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const selector of selectors) {
      out.add(selector);
      for (const target of aliases[selector] ?? []) out.add(target);
    }
    return out;
  };
  const enabledToolsets = expand(policy.enabledToolsets ?? []);
  const disabledToolsets = expand(policy.disabledToolsets ?? []);
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
