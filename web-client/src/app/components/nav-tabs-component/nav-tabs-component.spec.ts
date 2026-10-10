import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavTabsComponent } from './nav-tabs-component';
import { MemoryReviewService } from '../../services/memory-review.service';

describe('NavTabsComponent', () => {
  let component: NavTabsComponent;
  let fixture: ComponentFixture<NavTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavTabsComponent],
      providers: [
        provideRouter([]),
        { provide: MemoryReviewService, useValue: { pendingCount: () => 0 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavTabsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose all sixteen blueprint tabs starting with chat', () => {
    expect(component.tabs).toHaveLength(16);
    expect(component.tabs[0]?.label).toBe('Chat');
    expect(component.tabs.map((tab) => tab.path)).toContain('skills');
    expect(component.tabs.map((tab) => tab.path)).toContain('identity');
  });

  it('does not duplicate the theme or settings controls in the topbar (M20c)', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    // Theme lives in the footer status bar only.
    const themeButton = [...compiled.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.toLowerCase().includes('theme'),
    );
    expect(themeButton).toBeUndefined();
    // Settings live in the Client tab only — no cog shortcut in the topbar.
    expect(compiled.querySelector('a[aria-label="Client settings"]')).toBeNull();
    // The About button remains.
    expect(compiled.querySelector('button[aria-label="About ICOS"]')).not.toBeNull();
  });

  it('should open and close the about dialog', () => {
    expect(component.aboutOpen()).toBe(false);
    component.openAbout();
    expect(component.aboutOpen()).toBe(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="dialog"]')).not.toBeNull();
    component.closeAbout();
    expect(component.aboutOpen()).toBe(false);
  });

  it('should focus the dialog close button on open and return focus on close', async () => {
    component.openAbout();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.ownerDocument.activeElement?.textContent).toContain('Close');
    component.closeAbout();
    fixture.detectChanges();
    expect(compiled.ownerDocument.activeElement?.getAttribute('aria-label')).toBe('About ICOS');
  });

  it('should ignore close requests when the dialog is already closed', () => {
    expect(component.aboutOpen()).toBe(false);
    component.closeAbout();
    expect(component.aboutOpen()).toBe(false);
  });
});
