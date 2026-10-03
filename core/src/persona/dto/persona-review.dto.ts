import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { PersonaReviewOutcome } from '../persona.types';

const PERSONA_REVIEW_OUTCOMES: PersonaReviewOutcome[] = [
  'approve_to_identity',
  'approve_to_user_model',
  'approve_to_relationship',
  'reject',
  'archive_as_transient',
  'needs_more_evidence',
];

/** A persona candidate review (M14f). A reason is always required. */
export class PersonaReviewDto {
  @IsIn(PERSONA_REVIEW_OUTCOMES)
  outcome!: PersonaReviewOutcome;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reviewedBy!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
