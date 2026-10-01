import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LoginPage } from './login-page';
import { AuthService } from '../../services/auth.service';

describe('LoginPage', () => {
  const auth = { login: vi.fn() };

  beforeEach(async () => {
    auth.login.mockReset();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('requires a token before submitting', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    const component = fixture.componentInstance;

    await component.submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(component.form.invalid).toBe(true);
  });

  it('submits a trimmed token and surfaces failures', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    const component = fixture.componentInstance;
    component.form.controls.token.setValue('  secret-token  ');

    auth.login.mockRejectedValueOnce(new Error('invalid token'));
    await component.submit();
    expect(auth.login).toHaveBeenCalledWith('secret-token');
    expect(component.error()).toBe('invalid token');
    expect(component.submitting()).toBe(false);
  });
});
