import type { ToolDescriptor } from './tool-registry';
import { discoverTools } from './tool-discovery';

function tool(
  name: string,
  toolset: string,
  description: string,
): ToolDescriptor {
  return {
    name,
    version: 1,
    description,
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

const CATALOG: ToolDescriptor[] = [
  tool('read_file', 'files', 'Read a file from the workspace.'),
  tool('write_file', 'files', 'Write a file.'),
  tool('web_search', 'web', 'Search the web.'),
  tool('memory', 'memory', 'Search and store memory.'),
  tool('cronjob_manage', 'cron', 'Schedule a recurring job.'),
  tool('mcp_github_create_issue', 'mcp-github', 'Create a GitHub issue.'),
];

describe('discoverTools', () => {
  it('ranks a name hit above a description hit', () => {
    const matches = discoverTools(CATALOG, 'read file');
    expect(matches[0].tool.name).toBe('read_file');
    expect(matches[0].matchedOn).toContain('name');
  });

  it('matches a toolset token', () => {
    const matches = discoverTools(CATALOG, 'files');
    expect(matches.map((m) => m.tool.name)).toEqual(
      expect.arrayContaining(['read_file', 'write_file']),
    );
    expect(matches[0].matchedOn).toContain('toolset');
  });

  it('matches an MCP tool by server token', () => {
    const matches = discoverTools(CATALOG, 'github issue');
    expect(matches[0].tool.name).toBe('mcp_github_create_issue');
  });

  it('falls back to the description', () => {
    const matches = discoverTools(CATALOG, 'schedule');
    expect(matches.map((m) => m.tool.name)).toEqual(['cronjob_manage']);
    expect(matches[0].matchedOn).toEqual(['description']);
  });

  it('never matches on a zero score', () => {
    expect(discoverTools(CATALOG, 'zzzzzz')).toEqual([]);
  });

  it('ignores empty and single-character input', () => {
    expect(discoverTools(CATALOG, '')).toEqual([]);
    expect(discoverTools(CATALOG, 'a b c')).toEqual([]);
  });

  it('respects the limit and is deterministic', () => {
    const first = discoverTools(CATALOG, 'file write read', 2);
    const second = discoverTools(CATALOG, 'file write read', 2);
    expect(first).toHaveLength(2);
    expect(first.map((m) => m.tool.name)).toEqual(
      second.map((m) => m.tool.name),
    );
  });
});
