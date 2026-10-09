/**
 * Turn attachments (M16.2). A `TurnAttachment` is the reference sent with a
 * conversation turn; `StoredAttachment` is the server's response after upload
 * (the reference plus the id and creation time).
 */
export interface TurnAttachment {
  /** Filename or title, when known. */
  name?: string;
  /** Content type, when known. */
  contentType?: string;
  /** API reference the core can resolve. */
  url: string;
  /** Size in bytes, when known. */
  sizeBytes?: number;
}

export interface StoredAttachment extends TurnAttachment {
  id: string;
  createdAt: string;
}

/** What the composer emits: the message plus its uploaded attachment refs. */
export interface ComposerSubmission {
  message: string;
  attachments: readonly TurnAttachment[];
}

/**
 * Reduce a stored attachment (server response) to the reference a turn
 * accepts. The request DTO rejects unknown properties, so `id`/`createdAt`
 * must not be sent.
 */
export function toTurnAttachment(stored: StoredAttachment): TurnAttachment {
  return {
    url: stored.url,
    ...(stored.name ? { name: stored.name } : {}),
    ...(stored.contentType ? { contentType: stored.contentType } : {}),
    ...(typeof stored.sizeBytes === 'number'
      ? { sizeBytes: stored.sizeBytes }
      : {}),
  };
}
