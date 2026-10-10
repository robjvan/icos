import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CoreApiService } from './core-api.service';
import { ContextService } from './context.service';
import type { ContextSettings } from '../models/context';

const SETTINGS: ContextSettings = {
  contextWindow: 1_000_000,
  maxOutputTokens: 8192,
  usableTokens: 991_808,
  triggerTokens: 793_446,
  target: 0.8,
  enabled: true,
};

describe('ContextService', () => {
  it('reads settings, a session summary, and writes a patch', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ settings: SETTINGS })
      .mockResolvedValueOnce({ sessionId: 's1', summary: null, settings: SETTINGS });
    const put = vi
      .fn()
      .mockResolvedValue({ settings: { ...SETTINGS, target: 0.9 } });

    await TestBed.configureTestingModule({
      providers: [
        ContextService,
        { provide: CoreApiService, useValue: { get, put } },
      ],
    }).compileComponents();

    const service = TestBed.inject(ContextService);
    expect(await service.settings()).toEqual(SETTINGS);
    expect(await service.summary('s1')).toEqual({
      sessionId: 's1',
      summary: null,
      settings: SETTINGS,
    });
    expect(get).toHaveBeenNthCalledWith(2, '/core/context/summary', {
      sessionId: 's1',
    });
    expect((await service.update({ target: 0.9 })).target).toBe(0.9);
    expect(put).toHaveBeenCalledWith('/core/context', { target: 0.9 });
  });
});
