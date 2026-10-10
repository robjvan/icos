import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { ToolPrefsService } from './tool-prefs.service';

describe('ToolPrefsService', () => {
  let dir: string;
  let path: string;

  const config = (): CoreConfig =>
    ({ toolPrefsPath: path }) as unknown as CoreConfig;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-tool-prefs-'));
    path = join(dir, 'tool-prefs.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty and persists set overrides across reloads', () => {
    const service = new ToolPrefsService(config());
    expect(service.isAutoApproved('terminal')).toBe(false);
    expect(service.list()).toEqual([]);

    expect(service.setAutoApproved('terminal', true)).toEqual(['terminal']);
    expect(service.isAutoApproved('terminal')).toBe(true);

    const reloaded = new ToolPrefsService(config());
    expect(reloaded.isAutoApproved('terminal')).toBe(true);
    expect(reloaded.list()).toEqual(['terminal']);

    reloaded.setAutoApproved('terminal', false);
    expect(new ToolPrefsService(config()).list()).toEqual([]);
  });

  it('tolerates a missing or corrupt file', () => {
    const missing = new ToolPrefsService(config());
    expect(missing.list()).toEqual([]);
  });
});
