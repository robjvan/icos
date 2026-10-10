import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePencil, LucideSearch, LucideTrash2 } from '@lucide/angular';
import { ConversationStore } from '../../services/conversation-store';
import { SkillService } from '../../services/skill.service';
import type { SkillBody, SkillDescriptor, SkillMatch } from '../../models/skill';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

type SkillModalMode = 'closed' | 'view' | 'edit';

/**
 * Skills tab (M20e): catalog + discovery, a detail modal with inline
 * view/edit/delete, and hover row actions. The filesystem stays the writer —
 * these controls mirror `PUT`/`DELETE /core/skills/:name`.
 */
@Component({
  selector: 'app-skills-tab',
  imports: [ReactiveFormsModule, LucideSearch, LucidePencil, LucideTrash2, TabPlaceholder],
  templateUrl: './skills-tab.html',
  styleUrl: './skills-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.Escape)': 'onEscape()',
  },
})
export class SkillsTab implements OnInit {
  private readonly skillsApi = inject(SkillService);
  private readonly store = inject(ConversationStore);

  private readonly skillDialog = viewChild<ElementRef<HTMLElement>>('skillDialog');
  private readonly confirmDialog = viewChild<ElementRef<HTMLElement>>('confirmDialog');

  readonly skills = signal<readonly SkillDescriptor[]>([]);
  readonly enabled = signal(true);
  readonly skippedCount = signal(0);
  readonly matches = signal<readonly SkillMatch[]>([]);
  readonly detail = signal<SkillBody | null>(null);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly mode = signal<SkillModalMode>('closed');
  readonly saving = signal(false);
  readonly pendingDelete = signal<string | null>(null);

  readonly searchForm = new FormGroup({
    query: new FormControl('', { nonNullable: true }),
  });

  readonly editForm = new FormGroup({
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** The full catalog shows only when the discover query is empty. */
  readonly catalogVisible = computed(() => this.query().trim() === '');

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const catalog = await this.skillsApi.list();
      this.enabled.set(catalog.enabled);
      this.skills.set(catalog.skills);
      this.skippedCount.set(catalog.skipped.length);
    } catch (error) {
      this.skills.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Live discovery: empty query restores the full catalog. */
  onQueryInput(): void {
    const value = this.searchForm.controls.query.value;
    this.query.set(value);
    if (value.trim() === '') {
      this.matches.set([]);
      return;
    }
    void this.discover(value);
  }

  submitDiscover(): void {
    this.onQueryInput();
  }

  private async discover(value: string): Promise<void> {
    this.error.set(null);
    try {
      const result = await this.skillsApi.discover(value);
      this.matches.set(result.matches);
    } catch (error) {
      this.matches.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async openSkill(name: string): Promise<void> {
    this.error.set(null);
    try {
      this.detail.set(await this.skillsApi.body(name));
      this.mode.set('view');
      this.focusDialog();
    } catch (error) {
      this.detail.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async openEdit(name: string): Promise<void> {
    this.error.set(null);
    try {
      const body = await this.skillsApi.body(name);
      this.detail.set(body);
      this.editForm.setValue({ description: body.description, body: body.body });
      this.mode.set('edit');
      this.focusDialog();
    } catch (error) {
      this.detail.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  startEdit(): void {
    const detail = this.detail();
    if (!detail) return;
    this.editForm.setValue({ description: detail.description, body: detail.body });
    this.mode.set('edit');
    this.focusDialog();
  }

  cancelEdit(): void {
    this.mode.set('view');
  }

  async save(): Promise<void> {
    const detail = this.detail();
    if (!detail || this.editForm.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const { description, body } = this.editForm.getRawValue();
      const updated = await this.skillsApi.update(detail.name, { description, body });
      this.detail.set({ ...detail, description: updated.description, body });
      this.mode.set('view');
      await this.refresh();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  confirmDelete(name: string): void {
    this.pendingDelete.set(name);
    this.focusDialog();
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  async doDelete(): Promise<void> {
    const name = this.pendingDelete();
    if (!name) return;
    this.error.set(null);
    try {
      await this.skillsApi.remove(name);
      this.pendingDelete.set(null);
      this.close();
      await this.refresh();
    } catch (error) {
      this.pendingDelete.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  close(): void {
    this.mode.set('closed');
    this.detail.set(null);
  }

  onEscape(): void {
    if (this.pendingDelete() !== null) {
      this.cancelDelete();
      return;
    }
    if (this.mode() !== 'closed') {
      this.close();
    }
  }

  currentSessionId(): string | null {
    return this.store.sessionId();
  }

  private focusDialog(): void {
    setTimeout(
      () =>
        (this.confirmDialog() ?? this.skillDialog())?.nativeElement.focus({
          preventScroll: true,
        }),
      0,
    );
  }
}
