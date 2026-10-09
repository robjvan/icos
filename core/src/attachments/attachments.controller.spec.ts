import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { CoreConfig } from '../config';
import { AttachmentStore } from './attachment.store';
import type { StoredAttachment } from './attachment.store';
import { AttachmentsController } from './attachments.controller';

function build(config: Partial<CoreConfig>): {
  controller: AttachmentsController;
  save: jest.Mock<
    StoredAttachment,
    [{ originalName: string; contentType: string; buffer: Buffer }]
  >;
} {
  const save = jest.fn(
    (input: {
      originalName: string;
      contentType: string;
      buffer: Buffer;
    }): StoredAttachment => ({
      id: 'a1',
      name: input.originalName,
      contentType: input.contentType,
      sizeBytes: input.buffer.length,
      url: '/core/attachments/a1',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  const store = {
    save,
    get: jest.fn(() => null),
  } as unknown as AttachmentStore;
  return {
    controller: new AttachmentsController(config as CoreConfig, store),
    save,
  };
}

const file = (overrides: Record<string, unknown> = {}) => ({
  originalname: 'a.png',
  mimetype: 'image/png',
  size: 5,
  buffer: Buffer.from('hello'),
  ...overrides,
});

const CONFIG: Partial<CoreConfig> = {
  attachmentsMaxBytes: 10,
  attachmentsAllowedMimeTypes: ['image/png', 'text/plain'],
};

describe('AttachmentsController', () => {
  it('rejects a request with no file', () => {
    const { controller } = build(CONFIG);
    expect(() => controller.upload(undefined)).toThrow(BadRequestException);
  });

  it('rejects a file over the configured size', () => {
    const { controller } = build(CONFIG);
    expect(() => controller.upload(file({ size: 11 }))).toThrow(
      PayloadTooLargeException,
    );
  });

  it('rejects a disallowed content type', () => {
    const { controller } = build(CONFIG);
    expect(() =>
      controller.upload(file({ mimetype: 'application/zip' })),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('stores an allowed file and returns its reference', () => {
    const { controller, save } = build(CONFIG);
    const result = controller.upload(file());

    expect(result).toMatchObject({
      id: 'a1',
      name: 'a.png',
      contentType: 'image/png',
      url: '/core/attachments/a1',
    });
    expect(save).toHaveBeenCalledTimes(1);
    const arg = save.mock.calls[0]?.[0];
    expect(arg?.originalName).toBe('a.png');
    expect(arg?.contentType).toBe('image/png');
    expect(arg?.buffer.toString()).toBe('hello');
  });

  it('404s an unknown attachment on download', () => {
    const { controller } = build(CONFIG);
    const res = {} as Response;
    expect(() => controller.download('missing', res)).toThrow(
      NotFoundException,
    );
  });
});
