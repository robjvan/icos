import { resolveToolPolicy } from './tool-policy';
import type { ToolDescriptor } from './tool-registry';

function tool(name: string, toolset: string): ToolDescriptor {
  return {
    name,
    version: 1,
    description: name,
    approval: 'none',
    toolset,
    argsSchema: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {},
    },
  };
}

const TOOLS: readonly ToolDescriptor[] = [
  tool('session.search', 'session'),
  tool('session.rename', 'session'),
  tool('channel.send', 'channel'),
  tool('web_search', 'web'),
];

const names = (list: readonly ToolDescriptor[]): string[] =>
  list.map((descriptor) => descriptor.name);

describe('resolveToolPolicy', () => {
  it('offers everything by default (opt-out)', () => {
    const { offered, disabled } = resolveToolPolicy(TOOLS);
    expect(names(offered)).toEqual([
      'session.search',
      'session.rename',
      'channel.send',
      'web_search',
    ]);
    expect(disabled).toEqual([]);
  });

  it('is opt-in when enabledToolsets is non-empty', () => {
    const { offered, disabled } = resolveToolPolicy(TOOLS, {
      enabledToolsets: ['session'],
    });
    expect(names(offered)).toEqual(['session.search', 'session.rename']);
    expect(names(disabled)).toEqual(['channel.send', 'web_search']);
  });

  it('disables a whole toolset', () => {
    const { offered } = resolveToolPolicy(TOOLS, {
      disabledToolsets: ['session'],
    });
    expect(names(offered)).toEqual(['channel.send', 'web_search']);
  });

  it('disables individual tools', () => {
    const { offered } = resolveToolPolicy(TOOLS, {
      disabledTools: ['channel.send'],
    });
    expect(names(offered)).toEqual([
      'session.search',
      'session.rename',
      'web_search',
    ]);
  });

  it('lets an explicit tool enable win over a disabled toolset', () => {
    const { offered } = resolveToolPolicy(TOOLS, {
      disabledToolsets: ['session'],
      enabledTools: ['session.rename'],
    });
    expect(names(offered)).toEqual([
      'session.rename',
      'channel.send',
      'web_search',
    ]);
  });
});
