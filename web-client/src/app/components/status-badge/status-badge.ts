import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  LucideAlertTriangle,
  LucideCheck,
  LucideCircleDashed,
  LucideClock,
  LucideMinusCircle,
  LucidePlay,
  LucideX,
  LucideZap,
} from '@lucide/angular';
import type { ClaimTone } from '../../models/claim';
import type { ReviewState } from '../../models/promotion';

/**
 * Shared accessible status badge: icon + text label + colour, never
 * colour alone (WCAG 1.4.1). Used by both Memory lenses over one
 * status system.
 */
@Component({
  selector: 'app-status-badge',
  imports: [
    LucideAlertTriangle,
    LucideCheck,
    LucideCircleDashed,
    LucideClock,
    LucideMinusCircle,
    LucidePlay,
    LucideX,
    LucideZap,
  ],
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly state = input<ReviewState | ClaimTone | undefined>(undefined);
  readonly label = input.required<string>();

  readonly icon = computed(() => {
    switch (this.state()) {
      case 'PENDING':
        return 'clock';
      case 'AWAITING_SWEEP':
        return 'play';
      case 'APPROVED':
      case 'active':
        return 'check';
      case 'AUTO':
        return 'zap';
      case 'REJECTED':
        return 'x';
      case 'FAILED':
      case 'contradicted':
        return 'alert';
      case 'candidate':
        return 'dashed';
      case 'retired':
        return 'minus';
      default:
        return 'clock';
    }
  });

  readonly toneClass = computed(() => {
    switch (this.state()) {
      case 'AWAITING_SWEEP':
      case 'contradicted':
        return 'badge-amber';
      case 'REJECTED':
      case 'FAILED':
        return 'badge-red';
      case 'APPROVED':
      case 'AUTO':
      case 'candidate':
      case 'retired':
        return 'badge-muted';
      case 'PENDING':
      case 'active':
      default:
        return 'badge-default';
    }
  });
}
