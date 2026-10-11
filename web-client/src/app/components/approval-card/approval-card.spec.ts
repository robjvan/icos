import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ApprovalCard } from './approval-card';

describe('ApprovalCard', () => {
  let component: ApprovalCard;
  let fixture: ComponentFixture<ApprovalCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApprovalCard],
    }).compileComponents();

    fixture = TestBed.createComponent(ApprovalCard);
    fixture.componentRef.setInput('approval', {
      id: 'a1',
      sessionId: 's1',
      action: 'rename',
      description: 'Rename session',
      status: 'pending',
      createdAt: 't',
      updatedAt: 't',
    });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit approve and reject with the approval id', () => {
    const emitted: { id: string; decision: 'approve' | 'reject' }[] = [];
    component.resolved.subscribe((event) => emitted.push(event));
    component.approve();
    component.reject();
    expect(emitted).toEqual([
      { id: 'a1', decision: 'approve' },
      { id: 'a1', decision: 'reject' },
    ]);
  });

  it('should show the delegation goal when the approval comes from a child', () => {
    fixture.componentRef.setInput('approval', {
      id: 'a2',
      sessionId: 'child-1',
      action: 'terminal',
      description: 'Run a command',
      status: 'pending',
      createdAt: 't',
      updatedAt: 't',
      delegation: {
        taskId: 'task-1',
        goal: 'research widgets',
        parentSessionId: 'parent-1',
      },
    });
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.delegation')?.textContent).toContain(
      'research widgets',
    );
  });
});
