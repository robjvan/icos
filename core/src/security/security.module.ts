import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { SecurityController } from './security.controller';

/** Exposure posture surface for the management UI (S5). */
@Module({
  controllers: [SecurityController],
  providers: [coreConfigProvider],
})
export class SecurityModule {}
