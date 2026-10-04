import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Composer } from './composer';
import { AttachmentService } from '../../services/attachment.service';
import type { ComposerSubmission, StoredAttachment } from '../../models/attachment';

const STORED: StoredAttachment = {
  id: 'a1',
  name: 'photo.png',
  contentType: 'image/png',
  sizeBytes: 1,
  url: '/core/attachments/a1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Composer', () => {
  let component: Composer;
  let fixture: ComponentFixture<Composer>;
  let upload: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    upload = vi.fn().mockResolvedValue(STORED);
    await TestBed.configureTestingModule({
      imports: [Composer],
      providers: [{ provide: AttachmentService, useValue: { upload } }],
    }).compileComponents();

    fixture = TestBed.createComponent(Composer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit trimmed messages and reset the form', async () => {
    const emitted: ComposerSubmission[] = [];
    component.submitted.subscribe((submission) => emitted.push(submission));
    component.form.controls.message.setValue('  hello  ');
    await component.onSubmit();
    expect(emitted).toEqual([{ message: 'hello', attachments: [] }]);
    expect(component.form.controls.message.value).toBe('');
  });

  it('should ignore empty submits', async () => {
    const emitted: ComposerSubmission[] = [];
    component.submitted.subscribe((submission) => emitted.push(submission));
    component.form.controls.message.setValue('   ');
    await component.onSubmit();
    expect(emitted).toEqual([]);
  });

  it('uploads selected files and includes their references in the submit', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    component.onFilesSelected({
      target: { files: [file], value: 'x' },
    } as unknown as Event);
    expect(component.attachments()).toEqual([file]);

    const emitted: ComposerSubmission[] = [];
    component.submitted.subscribe((submission) => emitted.push(submission));
    component.form.controls.message.setValue('hi');
    await component.onSubmit();

    expect(upload).toHaveBeenCalledWith(file);
    expect(emitted[0]?.message).toBe('hi');
    expect(emitted[0]?.attachments[0]).toEqual({
      url: '/core/attachments/a1',
      name: 'photo.png',
      contentType: 'image/png',
      sizeBytes: 1,
    });
    expect(component.attachments()).toEqual([]);
  });

  it('keeps the message and files when an upload fails', async () => {
    upload.mockRejectedValueOnce(new Error('HTTP 415'));
    const file = new File(['x'], 'a.zip');
    component.onFilesSelected({
      target: { files: [file], value: 'x' },
    } as unknown as Event);

    const emitted: ComposerSubmission[] = [];
    component.submitted.subscribe((submission) => emitted.push(submission));
    component.form.controls.message.setValue('hi');
    await component.onSubmit();

    expect(emitted).toEqual([]);
    expect(component.uploadError()).toContain('415');
    expect(component.attachments()).toEqual([file]);
    expect(component.form.controls.message.value).toBe('hi');
  });

  it('should remove individual attachments', () => {
    const a = new File(['x'], 'a.txt');
    const b = new File(['x'], 'b.txt');
    component.onFilesSelected({
      target: { files: [a, b], value: 'x' },
    } as unknown as Event);
    component.removeAttachment(0);
    expect(component.attachments()).toEqual([b]);
  });

  it('should return focus to the message box on demand', () => {
    fixture.detectChanges();
    component.focusInput();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.ownerDocument.activeElement?.id).toBe('composer-input');
  });
});
