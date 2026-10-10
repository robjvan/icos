import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { vi } from 'vitest';

import { SkillsTab } from './skills-tab';
import { ConversationStore } from '../../services/conversation-store';
import { SkillService } from '../../services/skill.service';

describe('SkillsTab', () => {
  let component: SkillsTab;
  let fixture: ComponentFixture<SkillsTab>;
  let skillsApi: {
    list: ReturnType<typeof vi.fn>;
    discover: ReturnType<typeof vi.fn>;
    body: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    skillsApi = {
      list: vi.fn().mockResolvedValue({ enabled: true, skills: [], skipped: [] }),
      discover: vi.fn().mockResolvedValue({
        query: 'test',
        matches: [{ name: 'a', score: 2, matchedOn: ['name'] }],
      }),
      body: vi
        .fn()
        .mockResolvedValue({ name: 'a', description: 'A.', version: '1.0.0', body: 'Body.' }),
      update: vi.fn().mockResolvedValue({ name: 'a', description: 'B.', version: '1.0.0' }),
      remove: vi.fn().mockResolvedValue({ deleted: true, name: 'a' }),
    };

    await TestBed.configureTestingModule({
      imports: [SkillsTab],
      providers: [
        { provide: SkillService, useValue: skillsApi },
        { provide: ConversationStore, useValue: { sessionId: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the catalog on init', () => {
    expect(component.skills()).toEqual([]);
    expect(component.enabled()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('shows the catalog when the query is empty, matches when it is not', async () => {
    expect(component.catalogVisible()).toBe(true);

    component.searchForm.controls.query.setValue('test');
    component.onQueryInput();
    await fixture.whenStable();
    expect(component.catalogVisible()).toBe(false);
    expect(skillsApi.discover).toHaveBeenCalledWith('test');
    expect(component.matches().map((m) => m.name)).toEqual(['a']);

    component.searchForm.controls.query.setValue('');
    component.onQueryInput();
    expect(component.catalogVisible()).toBe(true);
    expect(component.matches()).toEqual([]);
  });

  it('skips discovery on blank queries', () => {
    component.searchForm.controls.query.setValue('   ');
    component.onQueryInput();
    expect(skillsApi.discover).not.toHaveBeenCalled();
  });

  it('opens the view modal, edits, and saves', async () => {
    await component.openSkill('a');
    expect(component.mode()).toBe('view');
    expect(component.detail()?.body).toBe('Body.');

    component.startEdit();
    expect(component.mode()).toBe('edit');
    component.editForm.setValue({ description: 'B.', body: 'New.' });
    await component.save();
    expect(skillsApi.update).toHaveBeenCalledWith('a', { description: 'B.', body: 'New.' });
    expect(component.mode()).toBe('view');
  });

  it('confirms and deletes a skill', async () => {
    component.confirmDelete('a');
    expect(component.pendingDelete()).toBe('a');
    await component.doDelete();
    expect(skillsApi.remove).toHaveBeenCalledWith('a');
    expect(component.pendingDelete()).toBeNull();
    expect(component.mode()).toBe('closed');
  });

  it('should accept the search form type', () => {
    expect(component.searchForm).toBeInstanceOf(FormGroup);
  });
});
