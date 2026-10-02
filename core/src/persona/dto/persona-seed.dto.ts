import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { PersonaSeedSourceInput } from '../persona.types';

/**
 * Persona seed import request (M14c). The `sources` elements are validated
 * by the service (path containment, kind, size, `.md`); the DTO bounds the
 * top-level shape.
 */
export class PersonaSeedImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reviewedBy!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  sources!: PersonaSeedSourceInput[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
