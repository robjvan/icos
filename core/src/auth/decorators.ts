import { SetMetadata } from '@nestjs/common';
import type { AuthRole } from './session';

/** Marks a route (or controller) reachable without a session. */
export const IS_PUBLIC = 'auth:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Minimum role required; defaults to `user` (any authenticated). */
export const REQUIRED_ROLE = 'auth:role';
export const RequireRole = (role: AuthRole) => SetMetadata(REQUIRED_ROLE, role);
