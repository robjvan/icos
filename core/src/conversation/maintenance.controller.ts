import { Controller, HttpCode, Post } from '@nestjs/common';
import { MaintenanceService } from '../memory/maintenance.service';
import type { PassSummary } from '../memory/maintenance';

export class RunMaintenanceResponseDto {
  summary!: PassSummary;
}

/**
 * Explicit maintenance driver (M12a). The scheduled pass runs on
 * its own cadence; this endpoint is the manual trigger, test
 * driver, and recovery path — same pull pattern as promotions.
 * Read-only turns never wait on it.
 */
@Controller('core/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post('run')
  @HttpCode(200)
  async run(): Promise<RunMaintenanceResponseDto> {
    return { summary: await this.maintenance.runPass() };
  }
}
