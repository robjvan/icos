import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  let fixture: ComponentFixture<StatusBadge>;

  async function setup(state: 'PENDING' | 'FAILED' | 'AWAITING_SWEEP' | 'contradicted' | 'REJECTED', label: string) {
    await TestBed.configureTestingModule({
      imports: [StatusBadge],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('label', label);
    await fixture.whenStable();
  }

  it('should create', async () => {
    await setup('PENDING', 'Awaiting review');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the icon and the text label together', async () => {
    await setup('PENDING', 'Awaiting review');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Awaiting review');
    expect(compiled.querySelector('svg')).not.toBeNull();
  });

  it('should map failure states to the red tone', async () => {
    await setup('FAILED', 'Failed');
    expect(fixture.componentInstance.toneClass()).toBe('badge-red');
    fixture.componentRef.setInput('state', 'REJECTED');
    fixture.detectChanges();
    expect(fixture.componentInstance.toneClass()).toBe('badge-red');
  });

  it('should map warning states to the amber tone', async () => {
    await setup('AWAITING_SWEEP', 'Approved — not yet committed');
    expect(fixture.componentInstance.toneClass()).toBe('badge-amber');
    fixture.componentRef.setInput('state', 'contradicted');
    fixture.detectChanges();
    expect(fixture.componentInstance.toneClass()).toBe('badge-amber');
  });
});
