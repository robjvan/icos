import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { AttachmentStore } from './attachment.store';

function store(dir: string): AttachmentStore {
  return new AttachmentStore({ attachmentsDirPath: dir } as CoreConfig);
}

describe('AttachmentStore', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-att-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves and reads back an attachment', () => {
    const s = store(dir);
    const meta = s.save({
      originalName: 'photo.png',
      contentType: 'image/png',
      buffer: Buffer.from('hello'),
    });

    expect(meta.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(meta.name).toBe('photo.png');
    expect(meta.contentType).toBe('image/png');
    expect(meta.sizeBytes).toBe(5);
    expect(meta.url).toBe(`/core/attachments/${meta.id}`);

    const found = s.get(meta.id);
    expect(found?.meta.name).toBe('photo.png');
    expect(found?.path.startsWith(dir)).toBe(true);
  });

  it('sanitizes path traversal in the original name', () => {
    const s = store(dir);
    const meta = s.save({
      originalName: '../../etc/passwd',
      contentType: 'text/plain',
      buffer: Buffer.from('x'),
    });

    expect(meta.name).toBe('passwd');
    const found = s.get(meta.id);
    expect(found?.path.startsWith(dir)).toBe(true);
    expect(found?.path).not.toContain('..');
  });

  it('strips control characters and bounds the name', () => {
    const s = store(dir);
    const control = s.save({
      originalName: 'bad\u0000name.txt',
      contentType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    expect(control.name).toBe('badname.txt');

    const long = s.save({
      originalName: `${'a'.repeat(200)}.txt`,
      contentType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    expect(long.name.length).toBeLessThanOrEqual(120);
  });

  it('returns null for an unknown or malformed id', () => {
    const s = store(dir);
    expect(s.get('not-an-id')).toBeNull();
    expect(s.get('../../etc/passwd')).toBeNull();
    expect(s.get('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
