import type {
  NewProspectiveItem,
  ProspectiveItem,
  ProspectiveOption,
  ProspectiveStatus,
  ProspectiveTrigger,
} from './prospective-item';

/**
 * Clarification-queue boundary. Rows are written only by the
 * promotion path on contradiction (M10e trigger rules) and read by
 * the inspection API. `dismissed` has no writer until a later
 * milestone — denial/ignore leaves rows parked as `open`.
 */
export abstract class ProspectiveItemRepository {
  abstract create(item: NewProspectiveItem): Promise<ProspectiveItem>;

  abstract getItem(id: string): Promise<ProspectiveItem | null>;

  /** The open question for a subject+predicate, if one is parked. */
  abstract findOpenBySubjectPredicate(
    subject: string,
    predicate: string,
  ): Promise<ProspectiveItem | null>;

  /**
   * Fold a repeat contest into the parked row: unseen options are
   * appended (known claim ids never duplicate), the contest counter
   * bumps, and the trigger/question refresh to the latest caller's
   * values. Returns null when the row is missing.
   */
  abstract mergeContest(
    id: string,
    options: ProspectiveOption[],
    trigger: ProspectiveTrigger,
    suggestedQuestion: string,
  ): Promise<ProspectiveItem | null>;

  abstract listItems(options?: {
    status?: ProspectiveStatus;
    limit?: number;
  }): Promise<ProspectiveItem[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
