import type { ToolDescriptor } from './tool-registry';
import type { ToolMatch } from './tool-discovery';
import { TopBudgetedToolSelector } from './tool-selector';

function tool(name: string): ToolDescriptor {
  return {
    name,
    version: 1,
    description: name,
    approval: 'none',
    toolset: 'test',
    argsSchema: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {},
    },
  };
}

function match(name: string, score: number): ToolMatch {
  return { tool: tool(name), score, matchedOn: ['name'] };
}

describe('TopBudgetedToolSelector', () => {
  const selector = new TopBudgetedToolSelector();

  it('takes the top matches in rank order', () => {
    const matches = [match('a', 3), match('b', 2), match('c', 1)];
    expect(
      selector.select(matches, { maxTools: 2 }).map((t) => t.name),
    ).toEqual(['a', 'b']);
  });

  it('returns nothing for a zero budget', () => {
    expect(selector.select([match('a', 1)], { maxTools: 0 })).toEqual([]);
  });

  it('tolerates fewer matches than the budget', () => {
    expect(selector.select([match('a', 1)], { maxTools: 5 })).toHaveLength(1);
  });
});
