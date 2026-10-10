import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ToolsTab } from './tools-tab';
import { ToolService } from '../../services/tool.service';
import type { ToolInventoryEntry } from '../../models/tool';

describe('ToolsTab', () => {
  let component: ToolsTab;
  let fixture: ComponentFixture<ToolsTab>;
  let toolsApi: {
    inventory: ReturnType<typeof vi.fn>;
    discovery: ReturnType<typeof vi.fn>;
    setAutoApprove: ReturnType<typeof vi.fn>;
  };

  const tools: ToolInventoryEntry[] = [
    {
      name: 'read_file',
      toolset: 'files',
      description: 'Read a file.',
      approval: 'none',
      autoApprove: false,
    },
    {
      name: 'terminal',
      toolset: 'terminal',
      description: 'Run a command.',
      approval: 'required',
      autoApprove: false,
    },
  ];

  beforeEach(async () => {
    toolsApi = {
      inventory: vi.fn().mockResolvedValue({ tools }),
      discovery: vi.fn().mockResolvedValue({
        enabled: true,
        universe: tools.length,
        bounds: {
          maxPerTurn: 12,
          discoveryLimit: 8,
          pullMaxResults: 5,
          pullMaxPerTurn: 2,
          alwaysOn: ['search_platform_tools'],
        },
      }),
      setAutoApprove: vi.fn().mockResolvedValue({
        tools: tools.map((tool) =>
          tool.name === 'terminal' ? { ...tool, autoApprove: true } : tool,
        ),
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ToolsTab],
      providers: [{ provide: ToolService, useValue: toolsApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('loads the inventory from the server', () => {
    expect(component.tools().map((tool) => tool.name)).toEqual(['read_file', 'terminal']);
    expect(toolsApi.inventory).toHaveBeenCalled();
    expect(component.autoApprovedCount()).toBe(0);
  });

  it('persists auto-approve through the server and reflects the result', async () => {
    const terminal = component.tools()[1];
    expect(terminal).toBeDefined();
    if (!terminal) {
      return;
    }
    const event = { target: { checked: true } } as unknown as Event;
    component.onToggle(terminal, event);
    await fixture.whenStable();
    expect(toolsApi.setAutoApprove).toHaveBeenCalledWith('terminal', true);
    expect(component.autoApprovedCount()).toBe(1);
  });

  it('labels the approval policy', () => {
    expect(component.approvalLabel(tools[0])).toBe('no approval');
    expect(component.approvalLabel(tools[1])).toBe('approval required');
    expect(component.approvalLabel({ ...tools[1], autoApprove: true })).toBe('auto-approved');
  });
});
