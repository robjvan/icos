import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePaperclip, LucideSend, LucideX } from '@lucide/angular';
import type { ComposerSubmission, TurnAttachment } from '../../models/attachment';
import { toTurnAttachment } from '../../models/attachment';
import { AttachmentService } from '../../services/attachment.service';

/**
 * Message composer. Enter sends, Shift+Enter adds a newline.
 *
 * Attachments are uploaded to the core attachment store on submit (M16.2) and
 * carried as references with the turn. The server bounds size and content
 * type; on failure the message and files are kept so the user can retry.
 */
@Component({
  selector: 'app-composer',
  imports: [ReactiveFormsModule, LucidePaperclip, LucideSend, LucideX],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Composer {
  readonly busy = input(false);
  readonly submitted = output<ComposerSubmission>();

  private readonly attachmentsApi = inject(AttachmentService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  readonly form = new FormGroup({
    message: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Files chosen for the next turn (uploaded on submit). */
  readonly attachments = signal<readonly File[]>([]);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  readonly sendLabel = computed(() => {
    if (this.uploading()) return 'Uploading…';
    return this.busy() ? '...' : 'Send';
  });

  readonly sendDisabled = computed(() => this.busy() || this.uploading());

  async onSubmit(): Promise<void> {
    const message = this.form.controls.message.value.trim();
    if (!message || this.sendDisabled()) {
      return;
    }
    const files = this.attachments();
    this.uploadError.set(null);
    let refs: TurnAttachment[] = [];
    if (files.length > 0) {
      this.uploading.set(true);
      try {
        const stored = await Promise.all(
          files.map((file) => this.attachmentsApi.upload(file)),
        );
        refs = stored.map(toTurnAttachment);
      } catch (error) {
        // Keep the message and files so the user can retry.
        this.uploadError.set(
          error instanceof Error ? error.message : 'Upload failed',
        );
        this.uploading.set(false);
        return;
      }
      this.uploading.set(false);
    }
    this.form.reset();
    this.clearAttachments();
    this.submitted.emit({ message, attachments: refs });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.onSubmit();
    }
  }

  openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    if (files.length > 0) {
      this.attachments.update((current) => [...current, ...files]);
    }
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.attachments.update((current) => current.filter((_, i) => i !== index));
  }

  clearAttachments(): void {
    this.attachments.set([]);
    this.uploadError.set(null);
  }

  /** Return keyboard focus to the message box (session switch, turn done). */
  focusInput(): void {
    this.textarea()?.nativeElement.focus({ preventScroll: true });
  }
}
