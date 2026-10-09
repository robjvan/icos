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

const ALIASED: readonly ToolDescriptor[] = [
  tool('browser', 'browser'),
  tool('web_search', 'web'),
  tool('mcp_bytestash_list_snippets', 'mcp-bytestash'),
  tool('mcp_github_list_repos', 'mcp-github'),
  tool('mcp_browser_navigate', 'mcp-browser'),
];

const ALIASES = {
  bytestash: ['mcp-bytestash'],
  github: ['mcp-github'],
  browser: ['mcp-browser'],
  mcp: ['mcp-bytestash', 'mcp-github', 'mcp-browser'],
};

describe('resolveToolPolicy toolset aliases (M19)', () => {
  it('resolves a bare server name to its generated toolset', () => {
    const { offered } = resolveToolPolicy(ALIASED, {
      enabledToolsets: ['bytestash'],
      toolsetAliases: ALIASES,
    });
    expect(names(offered)).toEqual(['mcp_bytestash_list_snippets']);
  });

  it('resolves mcp to every generated toolset', () => {
    const { offered } = resolveToolPolicy(ALIASED, {
      enabledToolsets: ['mcp'],
      toolsetAliases: ALIASES,
    });
    expect(names(offered)).toEqual([
      'mcp_bytestash_list_snippets',
      'mcp_github_list_repos',
      'mcp_browser_navigate',
    ]);
  });

  it('composes a shared name with the built-in toolset (no shadowing)', () => {
    const { offered } = resolveToolPolicy(ALIASED, {
      enabledToolsets: ['browser'],
      toolsetAliases: ALIASES,
    });
    expect(names(offered)).toEqual(['browser', 'mcp_browser_navigate']);
  });

  it('selects only one server via its mcp-<server> name', () => {
    const { offered } = resolveToolPolicy(ALIASED, {
      enabledToolsets: ['mcp-github'],
      toolsetAliases: ALIASES,
    });
    expect(names(offered)).toEqual(['mcp_github_list_repos']);
  });

  it('disables a shared name on both sides; a per-tool enable still wins', () => {
    const { offered } = resolveToolPolicy(ALIASED, {
      disabledToolsets: ['browser'],
      enabledTools: ['browser'],
      toolsetAliases: ALIASES,
    });
    expect(names(offered)).toEqual([
      'browser',
      'web_search',
      'mcp_bytestash_list_snippets',
      'mcp_github_list_repos',
    ]);
  });
});
