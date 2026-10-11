import { ApprovalsController } from './approvals.controller';
import type { ApprovalService } from './approval.service';
import type { DelegationRepository } from '../subagents/delegation.repository';

function approval(sessionId: string) {
  return {
    id: 'appr-1',
    sessionId,
    action: 'terminal',
    description: 'Run a command',
    status: 'pending',
    createdAt: 't',
    updatedAt: 't',
  };
}

describe('ApprovalsController delegation tagging (M21.2)', () => {
  function build(
    delegations: Partial<DelegationRepository>,
  ): ApprovalsController {
    const approvals = {
      list: () => Promise.resolve([approval('child-1'), approval('parent-1')]),
      get: () => Promise.resolve(approval('child-1')),
    } as unknown as ApprovalService;
    return new ApprovalsController(
      approvals,
      delegations as DelegationRepository,
    );
  }

  const context = {
    taskId: 'task-1',
    goal: 'research widgets',
    parentSessionId: 'parent-1',
  };

  it('attaches delegation context to child-session approvals', async () => {
    const controller = build({
      contextForChild: (sessionId: string) =>
        Promise.resolve(sessionId === 'child-1' ? context : null),
    });
    const listed = await controller.list({});
    expect(listed.approvals).toHaveLength(2);
    expect(listed.approvals[0]).toMatchObject({ delegation: context });
    expect(listed.approvals[1]).not.toHaveProperty('delegation');
    expect(await controller.get('appr-1')).toMatchObject({
      delegation: context,
    });
  });

  it('degrades to untagged items when the store fails', async () => {
    const controller = build({
      contextForChild: () => Promise.reject(new Error('db down')),
    });
    const listed = await controller.list({});
    expect(listed.approvals).toHaveLength(2);
    expect(listed.approvals[0]).not.toHaveProperty('delegation');
  });
});
