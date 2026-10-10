import type { ToolDescriptor } from './tool-registry';
import type { ToolMatch } from './tool-discovery';

/**
 * Turn-scoped tool-selection seam (M20.7.1). Picks which discovered
 * candidates are injected this turn. A future selector (semantic,
 * model-assisted, learned) implements this interface without re-plumbing the
 * conversation path.
 */
export interface ToolSelectionBudget {
  /** Maximum tools to select (the per-turn injection bound). */
  maxTools: number;
}

export interface ToolSelector {
  select(
    matches: readonly ToolMatch[],
    budget: ToolSelectionBudget,
  ): ToolDescriptor[];
}

/**
 * Deterministic default: top-ranked matches up to `maxTools`, in discovery
 * rank order (score desc, name asc). Schema/context budgeting is enforced
 * upstream when the injected set is assembled.
 */
export class TopBudgetedToolSelector implements ToolSelector {
  select(
    matches: readonly ToolMatch[],
    budget: ToolSelectionBudget,
  ): ToolDescriptor[] {
    if (budget.maxTools <= 0) return [];
    return matches.slice(0, budget.maxTools).map((match) => match.tool);
  }
}
