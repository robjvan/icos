import { IsIn, IsString, MaxLength } from 'class-validator';

/** Select the active provider for one role (S4). */
export class SetActiveProviderDto {
  @IsIn(['conversation', 'memory'])
  role!: 'conversation' | 'memory';

  @IsString()
  @MaxLength(64)
  id!: string;
}
