import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AttachmentService } from './attachment.service';
import { CoreApiService } from './core-api.service';
import { ATTACHMENTS_ENDPOINT } from '../../constants';
import type { StoredAttachment } from '../models/attachment';

const STORED: StoredAttachment = {
  id: 'a1',
  name: 'a.png',
  contentType: 'image/png',
  sizeBytes: 1,
  url: '/core/attachments/a1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('AttachmentService', () => {
  it('uploads a file as multipart and returns the stored reference', async () => {
    const postForm = vi.fn(
      (endpoint: string, form: FormData): Promise<StoredAttachment> => {
        void endpoint;
        void form;
        return Promise.resolve(STORED);
      },
    );
    TestBed.configureTestingModule({
      providers: [
        AttachmentService,
        { provide: CoreApiService, useValue: { postForm } },
      ],
    });
    const service = TestBed.inject(AttachmentService);

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const result = await service.upload(file);

    expect(result).toMatchObject({ id: 'a1', url: '/core/attachments/a1' });
    expect(postForm).toHaveBeenCalledTimes(1);
    const [endpoint, form] = postForm.mock.calls[0] ?? ['', new FormData()];
    expect(endpoint).toBe(ATTACHMENTS_ENDPOINT);
    const stored = form.get('file') as File;
    expect(stored.name).toBe('a.png');
    expect(stored.type).toBe('image/png');
  });
});
