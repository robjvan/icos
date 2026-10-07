import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentStore } from '../attachments/attachment.store';
import type { CoreConfig } from '../config';
import type { VisionService } from '../vision/vision.service';
import { AttachmentImageResolver } from './attachment-images';

const ID = '00000000-0000-0000-0000-000000000000';

describe('AttachmentImageResolver', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-att-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function storeWith(path: string, contentType: string): AttachmentStore {
    return {
      get: (requested: string) =>
        requested === ID
          ? {
              meta: {
                id: ID,
                name: 'pic.png',
                contentType,
                sizeBytes: 4,
                url: `/core/attachments/${ID}`,
                createdAt: 't',
              },
              path,
            }
          : null,
    } as unknown as AttachmentStore;
  }

  function config(enabled: boolean): CoreConfig {
    return { llmVisionEnabled: enabled } as unknown as CoreConfig;
  }

  it('inlines a stored image as an image_url part', async () => {
    const file = join(dir, 'pic.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const analyze = jest.fn();
    const resolver = new AttachmentImageResolver(
      storeWith(file, 'image/png'),
      { analyze } as unknown as VisionService,
      config(true),
    );

    const result = await resolver.resolve([
      { url: `/core/attachments/${ID}`, contentType: 'image/png' },
    ]);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ type: 'image_url' });
    expect(result.description).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('describes images via the vision role when vision is disabled', async () => {
    const file = join(dir, 'pic.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const analyze = jest.fn(() =>
      Promise.resolve({ text: 'A teal square.', model: 'v' }),
    );
    const resolver = new AttachmentImageResolver(
      storeWith(file, 'image/png'),
      { analyze } as unknown as VisionService,
      config(false),
    );

    const result = await resolver.resolve([
      { url: `/core/attachments/${ID}`, contentType: 'image/png' },
    ]);

    expect(result.parts).toEqual([]);
    expect(result.description).toContain('A teal square.');
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('ignores non-image attachments', async () => {
    const resolver = new AttachmentImageResolver(
      storeWith(join(dir, 'x'), 'text/plain'),
      { analyze: jest.fn() } as unknown as VisionService,
      config(true),
    );

    const result = await resolver.resolve([
      { url: `/core/attachments/${ID}`, contentType: 'text/plain' },
      { url: 'https://example.com/page', name: 'page.html' },
    ]);

    expect(result).toEqual({ parts: [], description: null });
  });

  it('skips an oversized stored image', async () => {
    const file = join(dir, 'big.png');
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024));
    const resolver = new AttachmentImageResolver(
      storeWith(file, 'image/png'),
      { analyze: jest.fn() } as unknown as VisionService,
      config(true),
    );

    const result = await resolver.resolve([
      { url: `/core/attachments/${ID}`, contentType: 'image/png' },
    ]);

    expect(result).toEqual({ parts: [], description: null });
  });
});
