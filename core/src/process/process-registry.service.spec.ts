import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessInfo } from './process-registry.service';
import { ProcessRegistry } from './process-registry.service';

describe('ProcessRegistry', () => {
  let dir: string;
  let registry: ProcessRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-proc-'));
    registry = new ProcessRegistry();
  });

  afterEach(() => {
    for (const process of registry.list()) registry.kill(process.id);
    rmSync(dir, { recursive: true, force: true });
  });

  async function waitFor(
    id: string,
    predicate: (info: ProcessInfo) => boolean,
  ): Promise<ProcessInfo> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const info = registry.output(id);
      if (info && predicate(info)) return info;
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('starts a process, captures output, and reports exit', async () => {
    const started = registry.start({ command: 'echo hi', cwd: dir });
    expect(started.status).toBe('running');

    const done = await waitFor(started.id, (info) => info.status === 'exited');
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain('hi');
  });

  it('lists and kills a long-running process', async () => {
    const started = registry.start({ command: 'sleep 30', cwd: dir });
    expect(registry.list().map((info) => info.id)).toContain(started.id);

    expect(registry.kill(started.id)).toBe(true);
    const done = await waitFor(started.id, (info) => info.status === 'exited');
    expect(done.status).toBe('exited');
  });

  it('returns null/false for an unknown process', () => {
    expect(registry.output('nope')).toBeNull();
    expect(registry.kill('nope')).toBe(false);
  });
});
