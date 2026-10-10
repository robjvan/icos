import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ToolService } from '../../services/tool.service';
import type { ToolDiscoveryState, ToolInventoryEntry } from '../../models/tool';

/**
 * Tools tab (M20f): the real tool inventory from `GET /core/tools/inventory`,
 * with server-persisted global per-tool auto-approve toggles.
 */
@Component({
  selector: 'app-tools-tab',
  imports: [],
  templateUrl: './tools-tab.html',
  styleUrl: './tools-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsTab implements OnInit {
  private readonly toolsApi = inject(ToolService);

  readonly tools = signal<readonly ToolInventoryEntry[]>([]);
  readonly discovery = signal<ToolDiscoveryState | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal<string | null>(null);

  readonly autoApprovedCount = computed(
    () => this.tools().filter((tool) => tool.autoApprove).length,
  );

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const [inventory, discovery] = await Promise.all([
        this.toolsApi.inventory(),
        this.toolsApi.discovery().catch(() => null),
      ]);
      this.tools.set(inventory.tools);
      this.discovery.set(discovery);
    } catch (error) {
      this.tools.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  onToggle(tool: ToolInventoryEntry, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.toggle(tool, checked);
  }

  private async toggle(tool: ToolInventoryEntry, checked: boolean): Promise<void> {
    this.saving.set(tool.name);
    this.error.set(null);
    try {
      const result = await this.toolsApi.setAutoApprove(tool.name, checked);
      this.tools.set(result.tools);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(null);
    }
  }

  approvalLabel(tool: ToolInventoryEntry): string {
    if (tool.approval === 'none') {
      return 'no approval';
    }
    return tool.autoApprove ? 'auto-approved' : 'approval required';
  }
}
