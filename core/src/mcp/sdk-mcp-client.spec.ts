import { toPromptResult, toResourceRead } from './sdk-mcp-client';

describe('toResourceRead', () => {
  it('joins text contents and records the mime type', () => {
    expect(
      toResourceRead(
        {
          contents: [
            { uri: 'file:///a', text: 'line one', mimeType: 'text/plain' },
            { uri: 'file:///a', text: 'line two' },
          ],
        },
        'file:///a',
        100,
      ),
    ).toEqual({
      uri: 'file:///a',
      mimeType: 'text/plain',
      text: 'line one\nline two',
      isBinary: false,
      truncated: false,
    });
  });

  it('caps long text and flags truncation', () => {
    const result = toResourceRead(
      { contents: [{ uri: 'x', text: 'a'.repeat(50) }] },
      'x',
      10,
    );
    expect(result.text).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('flags binary content and never decodes it', () => {
    expect(
      toResourceRead(
        {
          contents: [{ uri: 'x', blob: 'aGVsbG8=', mimeType: 'image/png' }],
        },
        'x',
        100,
      ),
    ).toEqual({
      uri: 'x',
      mimeType: 'image/png',
      text: '',
      isBinary: true,
      truncated: false,
    });
  });

  it('stays readable for a mixed payload (text wins)', () => {
    const result = toResourceRead(
      {
        contents: [
          { uri: 'x', blob: 'aGk=' },
          { uri: 'x', text: 'readable' },
        ],
      },
      'x',
      100,
    );
    expect(result.isBinary).toBe(false);
    expect(result.text).toBe('readable');
  });

  it('treats malformed payloads as empty, never throwing', () => {
    expect(toResourceRead(null, 'x', 100)).toEqual({
      uri: 'x',
      text: '',
      isBinary: false,
      truncated: false,
    });
    expect(toResourceRead({ contents: ['nope', 42] }, 'x', 100)).toMatchObject({
      text: '',
      isBinary: false,
    });
  });
});

describe('toPromptResult', () => {
  it('keeps text messages, caps them, and carries the description', () => {
    expect(
      toPromptResult(
        {
          description: 'Greeting',
          messages: [
            { role: 'user', content: { type: 'text', text: 'hello' } },
            {
              role: 'assistant',
              content: { type: 'text', text: 'b'.repeat(20) },
            },
          ],
        },
        5,
      ),
    ).toEqual({
      description: 'Greeting',
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'bbbbb' },
      ],
    });
  });

  it('drops non-text and unknown-role messages rather than guessing', () => {
    expect(
      toPromptResult(
        {
          messages: [
            { role: 'system', content: { type: 'text', text: 'nope' } },
            { role: 'user', content: { type: 'image', data: 'x' } },
            { role: 'user', content: { type: 'text', text: 'kept' } },
          ],
        },
        100,
      ),
    ).toEqual({ messages: [{ role: 'user', text: 'kept' }] });
  });

  it('treats malformed payloads as empty, never throwing', () => {
    expect(toPromptResult(null, 100)).toEqual({ messages: [] });
    expect(toPromptResult({ messages: 'nope' }, 100)).toEqual({ messages: [] });
  });
});
