import { parseStream } from './discord.stream';

describe('parseStream', () => {
  it('parses the stream type out of a topic', () => {
    expect(parseStream('[icos-stream: chat]')).toBe('chat');
    expect(parseStream('prefix [icos-stream: status] trailing')).toBe('status');
  });

  it('is case-insensitive and honours a custom marker', () => {
    expect(parseStream('[ICOS-STREAM: CHAT]')).toBe('chat');
    expect(parseStream('[other: notify]', '[other:')).toBe('notify');
  });

  it('returns null without a marker, or a bare marker', () => {
    expect(parseStream(null)).toBeNull();
    expect(parseStream('just a topic')).toBeNull();
    expect(parseStream('[icos-stream:')).toBeNull();
  });
});
