import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  ApprovalSummary,
  ClarificationSummary,
  CommandPayload,
  ToolSummary,
  TurnStatus,
} from '../conversation.service';
import type { TurnAttachment } from '../attachments';
import type { HistoryMessage } from '../session.store';

/** A single attachment reference sent with a turn (M16.2). */
export class TurnAttachmentDto implements TurnAttachment {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

export class ConversationRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TurnAttachmentDto)
  attachments?: TurnAttachmentDto[];
}

export class ResumeRequestDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  requestId!: string;
}

export class CancelRunRequestDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  runId!: string;
}

export interface CancelRunResponse {
  runId: string;
  sessionId: string;
  state: string;
  cancelled: boolean;
}

export class ConversationResponseDto {
  status!: TurnStatus;
  sessionId!: string;
  requestId?: string;
  reply!: string;
  model!: string;
  command?: CommandPayload;
  tool?: ToolSummary;
  approval?: ApprovalSummary;
  clarification?: ClarificationSummary;
  outcome?: 'rejected' | 'cancelled' | 'expired';
  result?: unknown;
}

export class ConversationHistoryResponseDto {
  sessionId!: string;
  messages!: HistoryMessage[];
}
