import { IsUUID } from 'class-validator';
import type { RecallTrace } from '../../memory/recall-trace.store';

export class RecallTraceQueryDto {
  @IsUUID()
  sessionId!: string;
}

export class RecallTraceResponseDto {
  trace!: RecallTrace;
}
