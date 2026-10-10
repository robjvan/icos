import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CronService } from '../../services/cron.service';
import type { CronJob } from '../../models/cron';

/**
 * Cron tab (M20h): manage scheduled jobs against `GET/POST /core/cron`.
 * Mirrors the `cronjob_manage` tool — list, create, pause/resume, run-now,
 * delete (with an inline confirm).
 */
@Component({
  selector: 'app-cron-tab',
  imports: [ReactiveFormsModule],
  templateUrl: './cron-tab.html',
  styleUrl: './cron-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CronTab implements OnInit {
  private readonly cronApi = inject(CronService);

  readonly jobs = signal<readonly CronJob[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly pendingDelete = signal<string | null>(null);
  readonly lastRun = signal<{ id: string; reply: string | null; delivered: boolean } | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    schedule: new FormControl('0 9 * * *', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    prompt: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      this.jobs.set((await this.cronApi.list()).jobs);
    } catch (error) {
      this.jobs.set([]);
      this.error.set(this.describe(error));
    }
  }

  async create(): Promise<void> {
    if (this.form.invalid) {
      return;
    }
    this.error.set(null);
    try {
      const { name, schedule, prompt } = this.form.getRawValue();
      await this.cronApi.create({ name, schedule, prompt });
      this.form.reset({ name: '', schedule: '0 9 * * *', prompt: '' });
      await this.refresh();
    } catch (error) {
      this.error.set(this.describe(error));
    }
  }

  async pause(job: CronJob): Promise<void> {
    await this.act(job.id, () => this.cronApi.pause(job.id));
  }

  async resume(job: CronJob): Promise<void> {
    await this.act(job.id, () => this.cronApi.resume(job.id));
  }

  async run(job: CronJob): Promise<void> {
    this.busy.set(job.id);
    this.error.set(null);
    this.lastRun.set(null);
    try {
      const result = await this.cronApi.run(job.id);
      this.lastRun.set({ id: job.id, ...result });
      await this.refresh();
    } catch (error) {
      this.error.set(this.describe(error));
    } finally {
      this.busy.set(null);
    }
  }

  confirmDelete(job: CronJob): void {
    this.pendingDelete.set(job.id);
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  async doDelete(job: CronJob): Promise<void> {
    this.pendingDelete.set(null);
    await this.act(job.id, () => this.cronApi.remove(job.id));
  }

  private async act(id: string, action: () => Promise<unknown>): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    try {
      await action();
      await this.refresh();
    } catch (error) {
      this.error.set(this.describe(error));
    } finally {
      this.busy.set(null);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
