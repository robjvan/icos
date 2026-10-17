import { TestBed } from '@angular/core/testing';

import { ContextGauge } from './context-gauge';

describe('ContextGauge', () => {
  function gauge(
    used: number | null,
    budget = 100,
    trigger = 80,
  ): ContextGauge {
    const fixture = TestBed.createComponent(ContextGauge);
    fixture.componentRef.setInput('used', used);
    fixture.componentRef.setInput('budget', budget);
    fixture.componentRef.setInput('trigger', trigger);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('shows the used percentage and an ok tone under the trigger', () => {
    const component = gauge(50);
    expect(component.percent()).toBe(50);
    expect(component.tone()).toBe('ok');
  });

  it('warns past the trigger and goes danger at the budget', () => {
    expect(gauge(85).tone()).toBe('warn');
    expect(gauge(100).tone()).toBe('danger');
  });

  it('is idle with no context yet', () => {
    const component = gauge(null);
    expect(component.tone()).toBe('idle');
    expect(component.percent()).toBe(0);
    expect(component.label()).toContain('no context yet');
  });
});
