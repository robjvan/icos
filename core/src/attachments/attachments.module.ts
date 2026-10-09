import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { AttachmentStore } from './attachment.store';
import { AttachmentsController } from './attachments.controller';

/**
 * M16.2 attachment upload/storage. Standalone: the conversation layer accepts
 * attachment refs in a turn (M16.2a) and this module provides the upload
 * endpoint that produces them.
 */
@Module({
  controllers: [AttachmentsController],
  providers: [coreConfigProvider, AttachmentStore],
  exports: [AttachmentStore],
})
export class AttachmentsModule {}
