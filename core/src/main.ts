import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { CoreModule } from './core.module';
import { loadConfig } from './config';
import { RealtimeModule } from './realtime/realtime.module';
import {
  assessPosture,
  isRunningInContainer,
} from './security/security-posture';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const config = loadConfig();
  const core = await NestFactory.create<INestApplication>(CoreModule);

  core.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Explicit CORS allowlist (S1). No wildcard: the API answers
  // credentials-capable requests and a live socket, so only the origins
  // the operator named may call it. Empty list = same-origin only.
  if (config.corsAllowedOrigins.length > 0) {
    core.enableCors({
      origin: config.corsAllowedOrigins,
      credentials: true,
    });
  }

  await core.listen(config.port, config.host);

  // Same HTTP server, same port: no new infrastructure, no compose change.
  if (config.realtimeEnabled) {
    core.get(RealtimeModule).attach(core.getHttpServer() as Server);
  }

  const logger = new Logger('Security');
  const posture = assessPosture({
    host: config.host,
    port: config.port,
    corsAllowedOrigins: config.corsAllowedOrigins,
    exposeAcknowledged: config.exposeAcknowledged,
    authEnabled: config.authEnabled,
    inContainer: isRunningInContainer(process.env, existsSync),
  });
  for (const notice of posture.notices) {
    if (notice.level === 'warn') logger.warn(notice.message);
    else logger.log(notice.message);
  }
}

void bootstrap();
