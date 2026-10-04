/**
 * Discord topic-marker vocabulary (M16). A channel is *designated* for a
 * purpose by a marker in its topic — `[icos-stream: chat]` for chat,
 * `[icos-stream: status]` for presence — so a server can be configured by
 * editing a topic, with no env change and no stored id list.
 */

/** The default prefix; override with `DISCORD_STREAM_MARKER`. */
export const DEFAULT_STREAM_MARKER = '[icos-stream:';

/** The stream a channel's topic designates as the chat channel. */
export const CHAT_STREAM = 'chat';

/** The stream a channel's topic designates as the presence/status channel. */
export const STATUS_STREAM = 'status';

/**
 * Parse the stream type out of a channel topic: `[icos-stream: chat]` →
 * `'chat'`. Case-insensitive; null when the marker is absent or bare.
 */
export function parseStream(
  topic: string | null,
  marker: string = DEFAULT_STREAM_MARKER,
): string | null {
  if (!topic) return null;
  const index = topic.toLowerCase().indexOf(marker.toLowerCase());
  if (index === -1) return null;
  const after = topic.slice(index + marker.length).replace(/^\s+/, '');
  const stream = after.split(/[\s\]]+/)[0];
  return stream ? stream.toLowerCase() : null;
}
