import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DelegationService } from '../../services/delegation.service';
import { ConversationStore } from '../../services/conversation-store';
import type { Delegation } from '../../models/delegation';

/**
 * Agents tab (M21.2): delegated subagent tasks for the active session —
 * state, goal, and bounded result. Read-only; spawning stays with the
 * `delegate_task` tool and cancelling with `/agents cancel`.
 */
@Component({
  selector: 'app-agents-tab',
  imports: [],
  templateUrl: './agents-tab.html',
  styleUrl: './agents-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentsTab implements OnInit {
  private readonly delegationsApi = inject(DelegationService);
  private readonly conversation = inject(ConversationStore);

  readonly delegations = signal<readonly Delegation[]>([]);
  readonly error = signal<string | null>(null);

  readonly activeCount = computed(
    () =>
      this.delegations().filter(
        (d) => d.state === 'running' || d.state === 'awaiting_approval',
      ).length,
  );

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    const sessionId = this.conversation.sessionId();
    if (!sessionId) {
      this.delegations.set([]);
      return;
    }
    try {
      const result = await this.delegationsApi.list(sessionId);
      this.delegations.set(result.delegations);
    } catch (error) {
      this.delegations.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  shortId(id: string): string {
    return id.slice(0, 8);
  }
}
