import type { CoreConfig } from '../config';
import { ToolRegistry } from './tool-registry';
import { ToolPullStore } from './tool-pull.store';
import { ToolSurfaceService } from './tool-surface.service';

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    toolsDiscoveryEnabled: true,
    toolsAlwaysOn: ['memory', 'todo'],
    toolsMaxPerTurn: 6,
    toolsDiscoveryLimit: 8,
    toolsPullMaxResults: 5,
    toolsPullMaxPerTurn: 2,
    ...overrides,
  } as unknown as CoreConfig;
}

function surface(overrides: Partial<CoreConfig> = {}): {
  surface: ToolSurfaceService;
  pulls: ToolPullStore;
  all: number;
} {
  const registry = new ToolRegistry();
  const pulls = new ToolPullStore();
  return {
    surface: new ToolSurfaceService(config(overrides), registry, pulls),
    pulls,
    all: registry.list().length,
  };
}

describe('ToolSurfaceService', () => {
  it('injects the always-on core plus discovered tools, bounded', () => {
    const { surface: s, all } = surface();
    const { descriptors, allowedTools } = s.injected('s1', 'read the file');
    const names = descriptors.map((d) => d.name);
    expect(names).toContain('memory');
    expect(names).toContain('todo');
    expect(names).toContain('read_file');
    expect(names.length).toBeLessThanOrEqual(6);
    expect(names.length).toBeLessThan(all);
    expect(allowedTools).toEqual(names);
  });

  it('injects the whole universe when discovery is disabled', () => {
    const { surface: s, all } = surface({ toolsDiscoveryEnabled: false });
    expect(s.injected('s1', 'hello').descriptors).toHaveLength(all);
  });

  it('never surfaces a policy-disabled tool', () => {
    const { surface: s } = surface({ toolsDisabled: ['read_file'] });
    expect(
      s.injected('s1', 'read the file').descriptors.map((d) => d.name),
    ).not.toContain('read_file');
    expect(s.discover('read file').map((m) => m.tool.name)).not.toContain(
      'read_file',
    );
  });

  it('injects an operator-staged pull after the turn begins', () => {
    const { surface: s, pulls } = surface();
    pulls.stagePending('s1', ['web_search']);
    expect(
      s.injected('s1', 'hello').descriptors.map((d) => d.name),
    ).not.toContain('web_search');
    pulls.beginTurn('s1');
    expect(s.injected('s1', 'hello').descriptors.map((d) => d.name)).toContain(
      'web_search',
    );
  });

  it('injects a meta-tool pull for the current turn', () => {
    const { surface: s } = surface();
    s.stagePullNow('s1', ['web_search']);
    expect(s.injected('s1', 'hello').descriptors.map((d) => d.name)).toContain(
      'web_search',
    );
  });

  it('bounds repeated pulls per turn', () => {
    const { surface: s, pulls } = surface({ toolsPullMaxPerTurn: 1 });
    expect(s.canPull('s1')).toBe(true);
    s.recordPull('s1');
    expect(s.canPull('s1')).toBe(false);
    pulls.beginTurn('s1');
    expect(s.canPull('s1')).toBe(true);
  });
});
