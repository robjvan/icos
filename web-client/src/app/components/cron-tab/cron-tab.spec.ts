import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CronTab } from './cron-tab';
import { CronService } from '../../services/cron.service';
import type { CronJob } from '../../models/cron';

describe('CronTab', () => {
  let component: CronTab;
  let fixture: ComponentFixture<CronTab>;
  let cronApi: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  const job: CronJob = {
    id: 'job-1',
    name: 'morning',
    schedule: '0 9 * * *',
    prompt: 'brief me',
    sessionId: null,
    deliver: null,
    enabled: true,
    lastRunAt: null,
    nextRunAt: '2026-10-10T09:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    cronApi = {
      list: vi.fn().mockResolvedValue({ jobs: [job] }),
      create: vi.fn().mockResolvedValue({ job }),
      pause: vi.fn().mockResolvedValue({ job: { ...job, enabled: false } }),
      resume: vi.fn().mockResolvedValue({ job }),
      run: vi.fn().mockResolvedValue({ reply: 'done', delivered: false }),
      remove: vi.fn().mockResolvedValue({ deleted: true, id: 'job-1' }),
    };

    await TestBed.configureTestingModule({
      imports: [CronTab],
      providers: [{ provide: CronService, useValue: cronApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(CronTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create and load jobs', () => {
    expect(component).toBeTruthy();
    expect(component.jobs().map((j) => j.id)).toEqual(['job-1']);
    expect(cronApi.list).toHaveBeenCalled();
  });

  it('creates a job through the server', async () => {
    component.form.setValue({ name: 'nightly', schedule: '0 0 * * *', prompt: 'summarise' });
    await component.create();
    expect(cronApi.create).toHaveBeenCalledWith({
      name: 'nightly',
      schedule: '0 0 * * *',
      prompt: 'summarise',
    });
  });

  it('pauses and resumes through the server', async () => {
    await component.pause(job);
    expect(cronApi.pause).toHaveBeenCalledWith('job-1');
    await component.resume(job);
    expect(cronApi.resume).toHaveBeenCalledWith('job-1');
  });

  it('runs a job now and records the result', async () => {
    await component.run(job);
    expect(cronApi.run).toHaveBeenCalledWith('job-1');
    expect(component.lastRun()).toEqual({ id: 'job-1', reply: 'done', delivered: false });
  });

  it('deletes after an inline confirm', async () => {
    component.confirmDelete(job);
    expect(component.pendingDelete()).toBe('job-1');
    await component.doDelete(job);
    expect(cronApi.remove).toHaveBeenCalledWith('job-1');
    expect(component.pendingDelete()).toBeNull();
  });
});
