import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { AuthService } from './auth.service';
import { CSRF_HEADER } from './cookies';
import { IS_PUBLIC, REQUIRED_ROLE } from './decorators';
import type { AuthRole } from './session';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface HttpLikeRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * Global authentication gate (S2). Deny by default: every route needs a
 * valid session unless marked `@Public()`. Mutating requests must carry
 * the double-submit CSRF pair; routes marked `@RequireRole('admin')`
 * require the admin role. `AUTH_ENABLED=false` disables the gate
 * entirely (local/throwaway use only).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.authEnabled) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<HttpLikeRequest>();
    const cookieHeader = headerValue(request.headers['cookie']);
    const session = this.auth.verify(cookieHeader);
    if (!session) throw new UnauthorizedException('authentication required');

    if (MUTATING_METHODS.has(request.method.toUpperCase())) {
      const csrf = headerValue(request.headers[CSRF_HEADER]);
      if (!this.auth.csrfMatches(cookieHeader, csrf)) {
        throw new ForbiddenException('missing or invalid CSRF token');
      }
    }

    const required =
      this.reflector.getAllAndOverride<AuthRole>(REQUIRED_ROLE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'user';
    if (required === 'admin' && session.role !== 'admin') {
      throw new ForbiddenException('admin role required');
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
