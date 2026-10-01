import { SetMetadata } from '@nestjs/common';
import type { AuthRole } from './session';

/** Marks a route reachable without a session (login, liveness). */
export const IS_PUBLIC = 'auth:public';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC, true);

/** Minimum role required; defaults to `user` (any authenticated). */
export const REQUIRED_ROLE = 'auth:role';
export const RequireRole = (role: AuthRole): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLE, role);
