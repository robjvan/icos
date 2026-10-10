import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ContextService } from '../../services/context.service';
import { ConversationStore } from '../../services/conversation-store';
import type { ContextSettings, ContextSummary } from '../../models/context';

/**
 * Context segment (M20.6.3): the resolved budget read-out plus the
 * inspectable rolling summary for a session. Read-only here — the target
 * control lives in Client settings.
 */
@Component({
  selector: 'app-context-panel',
  imports: [],
  templateUrl: './context-panel.html',
  styleUrl: './context-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextPanel implements OnInit {
  private readonly contextApi = inject(ContextService);
  private readonly conversation = inject(ConversationStore);

  readonly settings = signal<ContextSettings | null>(null);
  readonly summary = signal<ContextSummary | null>(null);
  readonly sessionId = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  ngOnInit(): void {
    this.sessionId.set(this.conversation.sessionId() ?? '');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const settings = await this.contextApi.settings();
      this.settings.set(settings);
      const id = this.sessionId().trim();
      if (id) {
        const result = await this.contextApi.summary(id);
        this.summary.set(result.summary);
      } else {
        this.summary.set(null);
      }
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  useCurrentSession(): void {
    this.sessionId.set(this.conversation.sessionId() ?? '');
    void this.refresh();
  }

  onSessionInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.sessionId.set(input?.value ?? '');
  }

  format(value: number): string {
    return value.toLocaleString('en-US');
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
