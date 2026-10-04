import { Injectable, inject } from '@angular/core';
import { ATTACHMENTS_ENDPOINT } from '../../constants';
import type { StoredAttachment } from '../models/attachment';
import { CoreApiService } from './core-api.service';

/**
 * Uploads files to the core attachment store (M16.2). Each file is sent as
 * its own multipart request; the returned reference is what a turn carries.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly api = inject(CoreApiService);

  async upload(file: File): Promise<StoredAttachment> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.postForm<StoredAttachment>(ATTACHMENTS_ENDPOINT, form);
  }
}
