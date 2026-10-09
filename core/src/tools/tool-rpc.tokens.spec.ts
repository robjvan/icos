import { ToolRpcTokens } from './tool-rpc.tokens';

describe('ToolRpcTokens', () => {
  it('issues, verifies, and revokes tokens', () => {
    const tokens = new ToolRpcTokens();
    const token = tokens.issue('s1');
    expect(tokens.verify(token)).toBe('s1');
    tokens.revoke(token);
    expect(tokens.verify(token)).toBeNull();
  });

  it('rejects unknown and empty tokens', () => {
    const tokens = new ToolRpcTokens();
    expect(tokens.verify('nope')).toBeNull();
    expect(tokens.verify(undefined)).toBeNull();
  });
});
