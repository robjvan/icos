import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ToolRegistry } from './tool-registry';
import type { ToolDescriptor } from './tool-registry';
import { resolveToolPolicy } from './tool-policy';
import type { ToolPolicyConfig } from './tool-policy';
import { discoverTools } from './tool-discovery';
import type { ToolMatch } from './tool-discovery';
import { TopBudgetedToolSelector } from './tool-selector';
import type { ToolSelector } from './tool-selector';
import { ToolPullStore } from './tool-pull.store';

export interface InjectedTools {
  descriptors: ToolDescriptor[];
  allowedTools: string[];
}

/**
 * The tool surface (M20.7). Single source of truth for:
 * - the **universe** — the operator-policy-enabled tools (M17a);
 * - the **injected** set — always-on core ∪ staged pulls ∪ discovered, bounded
 *   per turn (M20.7.1/.2);
 * - discovery over the universe (the `search_platform_tools` meta-tool and
 *   `/tools`).
 *
 * Invariant: `injected ⊆ universe`. Discovery and pulls can only *narrow*
 * visibility within the operator policy — never widen it, never grant
 * execution. Every call still goes through `ToolRegistry.validate`
 * (`allowedTools`) and the normal approval flow.
 */
@Injectable()
export class ToolSurfaceService {
  private readonly selector: ToolSelector = new TopBudgetedToolSelector();

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly registry: ToolRegistry,
    private readonly pulls: ToolPullStore,
  ) {}

  /** Tools enabled by operator policy. */
  universe(): readonly ToolDescriptor[] {
    return resolveToolPolicy(this.registry.list(), this.policy()).offered;
  }

  /** Known-but-disabled tools (declared in the planning frame). */
  disabled(): readonly ToolDescriptor[] {
    return resolveToolPolicy(this.registry.list(), this.policy()).disabled;
  }

  /**
   * Tools injected for a turn/round: the always-on core, then any staged pull,
   * then deterministically-discovered tools, capped at `toolsMaxPerTurn`.
   * With discovery disabled, the whole universe is injected (pre-M20.7).
   */
  injected(sessionId: string, input: string): InjectedTools {
    const universe = this.universe();
    if (this.config.toolsDiscoveryEnabled === false) {
      return {
        descriptors: [...universe],
        allowedTools: universe.map((descriptor) => descriptor.name),
      };
    }
    const byName = new Map(
      universe.map((descriptor) => [descriptor.name, descriptor]),
    );
    const selected: ToolDescriptor[] = [];
    const seen = new Set<string>();
    const admit = (name: string): void => {
      const descriptor = byName.get(name);
      if (descriptor && !seen.has(name)) {
        seen.add(name);
        selected.push(descriptor);
      }
    };
    for (const name of this.config.toolsAlwaysOn ?? []) admit(name);
    // Explicit pulls are admitted before discovery, so a requested tool is not
    // crowded out by the discovery budget.
    for (const name of this.pulls.peek(sessionId)) admit(name);
    const budget = Math.max(
      0,
      (this.config.toolsMaxPerTurn ?? 12) - selected.length,
    );
    const matches = discoverTools(
      universe,
      input,
      this.config.toolsDiscoveryLimit ?? 8,
    );
    for (const descriptor of this.selector.select(matches, {
      maxTools: budget,
    })) {
      admit(descriptor.name);
    }
    return {
      descriptors: selected,
      allowedTools: selected.map((descriptor) => descriptor.name),
    };
  }

  /** Discover over the universe (meta-tool / `/tools`). Bounded. */
  discover(query: string, limit?: number): ToolMatch[] {
    return discoverTools(
      this.universe(),
      query,
      limit ?? this.config.toolsPullMaxResults ?? 5,
    );
  }

  /** Whether another meta-tool pull is allowed this turn. */
  canPull(sessionId: string): boolean {
    return (
      this.pulls.attemptsUsed(sessionId) <
      (this.config.toolsPullMaxPerTurn ?? 2)
    );
  }

  /** Record a meta-tool pull attempt. */
  recordPull(sessionId: string): void {
    this.pulls.recordAttempt(sessionId);
  }

  /** Clear staged pulls + attempt count for a session (end of turn). */
  clear(sessionId: string): void {
    this.pulls.clear(sessionId);
  }

  /**
   * Begin a fresh turn (M20.7.2): promote operator `/tools pull` names into the
   * active set and reset the meta-tool attempt count.
   */
  beginTurn(sessionId: string): void {
    this.pulls.beginTurn(sessionId);
  }

  /** Stage an operator pull for the next turn. */
  stagePull(sessionId: string, names: readonly string[]): void {
    this.pulls.stagePending(sessionId, names);
  }

  /** Stage a meta-tool pull for the current turn (bounded by `canPull`). */
  stagePullNow(sessionId: string, names: readonly string[]): void {
    this.pulls.stage(sessionId, names);
  }

  private policy(): ToolPolicyConfig {
    return {
      enabledToolsets: this.config.toolsEnabledToolsets,
      disabledToolsets: this.config.toolsDisabledToolsets,
      enabledTools: this.config.toolsEnabled,
      disabledTools: this.config.toolsDisabled,
      toolsetAliases: this.registry.toolsetAliases(),
    };
  }
}
