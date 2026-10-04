/**
 * A turn attachment (M16.2). A neutral, transport-agnostic reference: what
 * arrived with a turn, as metadata only. Contents are never fetched or
 * embedded into the prompt — the agent sees that a file exists and where to
 * reference it, not its bytes. `ChannelAttachment` (channels) is structurally
 * identical, so a transport can pass its attachments straight through.
 */
export interface TurnAttachment {
  /** Filename or title, when known. */
  name?: string;
  /** Content type, when known. */
  contentType?: string;
  /** URL or API reference to the stored file. */
  url: string;
  /** Size in bytes, when known. */
  sizeBytes?: number;
}

const MAX_ATTACHMENTS = 10;
const MAX_FIELD = 200;

/**
 * Build a bounded `<attachments>` system band describing the attachments
 * that arrived with this turn, or null when there are none (so a turn with
 * no attachments yields byte-identical context).
 */
export function buildAttachmentBand(
  attachments?: readonly TurnAttachment[],
): string | null {
  const present = (attachments ?? []).filter((item) => item.url !== '');
  if (present.length === 0) return null;
  const shown = present.slice(0, MAX_ATTACHMENTS);
  const lines = shown.map((item) => {
    const fields: string[] = [];
    if (item.name) fields.push(`name: ${clip(item.name)}`);
    if (item.contentType) fields.push(`type: ${clip(item.contentType)}`);
    if (typeof item.sizeBytes === 'number') {
      fields.push(`size: ${item.sizeBytes}`);
    }
    fields.push(`url: ${clip(item.url)}`);
    return `- ${fields.join(' | ')}`;
  });
  const omitted = present.length - shown.length;
  const header =
    'The turn arrived with attachment metadata below. Contents are NOT ' +
    'fetched — these are references only; do not claim to have read them.';
  const footer = omitted > 0 ? `\n(+${omitted} more omitted)` : '';
  return `<attachments>\n${header}\n${lines.join('\n')}${footer}\n</attachments>`;
}

function clip(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_FIELD ? `${clean.slice(0, MAX_FIELD)}…` : clean;
}
