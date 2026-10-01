import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { LoginDto } from './dto/login.dto';

/**
 * Authentication endpoints (S2). Login exchanges the bootstrap token
 * for a session cookie; logout clears it; session reports the current
 * state so a client can decide whether to show the login screen. All
 * three are public (login by definition; session/logout only ever
 * reveal/clear the caller's own state).
 */
@Controller('core/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): { authenticated: true; role: string } {
    const result = this.auth.login(dto.token, clientIp(request));
    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        throw new UnauthorizedException('too many attempts; try again later');
      }
      throw new UnauthorizedException('invalid token');
    }
    response.setHeader(
      'Set-Cookie',
      this.auth.loginCookies(result.session, result.csrf),
    );
    return { authenticated: true, role: result.role };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response): {
    authenticated: false;
  } {
    response.setHeader('Set-Cookie', this.auth.clearCookies());
    return { authenticated: false };
  }

  @Public()
  @Get('session')
  session(@Req() request: Request): { authenticated: boolean; role?: string } {
    const session = this.auth.verify(request.headers.cookie);
    return session
      ? { authenticated: true, role: session.role }
      : { authenticated: false };
  }
}

function clientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
