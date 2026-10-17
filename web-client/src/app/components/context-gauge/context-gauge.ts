import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * Context-window gauge (FG9c): an SVG donut showing how full the assembled
 * context is against the usable budget. Green under the compaction trigger,
 * amber past it, red near full. `size` picks the header chip or the panel ring.
 */
@Component({
  selector: 'app-context-gauge',
  imports: [],
  templateUrl: './context-gauge.html',
  styleUrl: './context-gauge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextGauge {
  /** Tokens used by the last assembled context (null = no turn yet). */
  readonly used = input<number | null>(null);
  /** Usable budget in tokens (window − output reserve). */
  readonly budget = input(0);
  /** Compaction trigger in tokens. */
  readonly trigger = input(0);
  /** `sm` for the chat-header chip, `lg` for the panel. */
  readonly size = input<'sm' | 'lg'>('sm');

  readonly radius = 15.9155; // 2πr for r=2.533… normalised to a 100 viewBox
  readonly circumference = 100;

  readonly ratio = computed(() => {
    const used = this.used();
    const budget = this.budget();
    if (used === null || budget <= 0) return 0;
    return Math.max(0, Math.min(1, used / budget));
  });

  readonly percent = computed(() => Math.round(this.ratio() * 100));

  readonly tone = computed<'ok' | 'warn' | 'danger' | 'idle'>(() => {
    if (this.used() === null || this.budget() <= 0) return 'idle';
    const used = this.used() ?? 0;
    if (used >= this.budget()) return 'danger';
    if (this.trigger() > 0 && used >= this.trigger()) return 'warn';
    return 'ok';
  });

  readonly dash = computed(
    () => `${(this.ratio() * this.circumference).toFixed(2)} ${this.circumference}`,
  );

  readonly label = computed(() => {
    if (this.used() === null) return 'no context yet';
    return `${this.percent()}% of the context window used`;
  });
}
