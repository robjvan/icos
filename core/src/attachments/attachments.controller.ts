import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { AttachmentStore } from './attachment.store';
import type { StoredAttachment } from './attachment.store';

/** The slice of multer's file object this controller reads. */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Absolute cap for the in-memory upload; the configured max is enforced in
 * the handler (multer's limit is static and cannot read config). */
const HARD_MAX_BYTES = 32 * 1024 * 1024;

/**
 * M16.2 web attachment surface. Admin-only (global auth guard) and bounded:
 * a size limit, a MIME allow-list, owner-only storage, and a validated id on
 * read. Returns a reference the composer can attach to a turn.
 */
@Controller('core/attachments')
export class AttachmentsController {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly store: AttachmentStore,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: HARD_MAX_BYTES } }),
  )
  upload(@UploadedFile() file?: UploadedFileLike): StoredAttachment {
    if (!file) {
      throw new BadRequestException('no file provided');
    }
    const max = this.config.attachmentsMaxBytes ?? HARD_MAX_BYTES;
    if (file.size > max) {
      throw new PayloadTooLargeException(`file exceeds the ${max}-byte limit`);
    }
    const allowed = this.config.attachmentsAllowedMimeTypes ?? [];
    if (!allowed.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `unsupported content type: ${file.mimetype}`,
      );
    }
    return this.store.save({
      originalName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Get(':id')
  download(@Param('id') id: string, @Res() res: Response): void {
    const found = this.store.get(id);
    if (!found) {
      throw new NotFoundException(`unknown attachment "${id}"`);
    }
    res.setHeader(
      'Content-Type',
      found.meta.contentType || 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${headerSafe(found.meta.name)}"`,
    );
    createReadStream(found.path).pipe(res);
  }
}

/** Never let a filename forge a header. */
function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, '_');
}
