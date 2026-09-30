import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { RecallTraceStore } from '../memory/recall-trace.store';
import { RecallTraceQueryDto, RecallTraceResponseDto } from './dto/recall.dto';

/**
 * Inspection API for turn-time recall (M11d). Read-only: the last
 * per-session trace — what was asked, found, ranked, noted, and
 * shown, with every skip reasoned. Ephemeral by design (process
 * memory, lost on restart); the ledger and journal stay the durable
 * record. Proposed questions are recommendations here, not parked
 * rows — parking stays promotion's job (M10e triggers).
 */
@Controller('core/recall')
export class RecallController {
  constructor(private readonly traces: RecallTraceStore) {}

  @Get('trace')
  trace(@Query() query: RecallTraceQueryDto): RecallTraceResponseDto {
    const trace = this.traces.get(query.sessionId);
    if (!trace) {
      throw new NotFoundException(
        `No recall trace for session "${query.sessionId}"`,
      );
    }
    return { trace };
  }
}
