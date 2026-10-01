import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Route guard (S2): a route is reachable only with a valid session;
 * otherwise the user is sent to the login screen.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const allowed = await auth.ensureChecked();
  return allowed ? true : router.createUrlTree(['/login']);
};
