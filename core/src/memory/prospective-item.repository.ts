import type {
  NewProspectiveItem,
  ProspectiveItem,
  ProspectiveOption,
  ProspectiveResolution,
  ProspectiveStatus,
  ProspectiveTrigger,
} from './prospective-item';

/**
 * Clarification-queue boundary. Rows are written by promotion on
 * contradiction (M10e trigger rules) and closed by explicit human
 * resolution (M12c) — denial/ignore leaves rows parked as `open`.
 * Read by the inspection API.
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

  /**
   * Close an open question with a recorded outcome (M12c
   * clarification completion): confirmed (standing affirmed),
   * corrected (revision noted by the caller), dismissed (ignored on
   * purpose). Always parks as `dismissed` with resolution +
   * timestamp — closing is terminal, never a reopen. Returns null
   * when missing, already closed, or the outcome is unknown.
   */
  abstract resolve(
    id: string,
    outcome: ProspectiveResolution,
  ): Promise<ProspectiveItem | null>;

  abstract listItems(options?: {
    status?: ProspectiveStatus;
    limit?: number;
  }): Promise<ProspectiveItem[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
