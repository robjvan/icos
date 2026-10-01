import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { coreConfigProvider } from '../config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * Authentication (S2). Registers the deny-by-default guard app-wide
 * (every route needs a session except `@Public()` ones) and exports
 * `AuthService` for the socket handshake. Config is re-provided here
 * like the other feature modules do.
 */
@Module({
  controllers: [AuthController],
  providers: [
    coreConfigProvider,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
