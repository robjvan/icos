import { Controller, Get } from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import type { HallucinationMitigationEntry } from './hallucination-ledger.repository';

/**
 * Hallucination-mitigation reporting surface (M15.5e). Read-only,
 * admin-only. Makes "every mitigation is logged" observable — the ledger is
 * append-only and nothing in the system rewrites output silently.
 */
@Controller('core/hallucination')
export class HallucinationController {
  constructor(private readonly ledger: HallucinationLedgerRepository) {}

  @RequireRole('admin')
  @Get('mitigations')
  async mitigations(): Promise<{
    mitigations: HallucinationMitigationEntry[];
  }> {
    return { mitigations: await this.ledger.list() };
  }
}
