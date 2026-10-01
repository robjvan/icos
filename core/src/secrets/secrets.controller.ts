import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { isValidSecretName } from './reference';
import { SecretResolver } from './secret-resolver';
import type { SecretMetadata } from './secret-store';
import { PutSecretDto } from './dto/secret.dto';

/**
 * Secret management (S3). Admin-only and **write-only**: reads expose
 * presence + metadata, never a value. Every response is `no-store`, and
 * errors carry a reason but never the value. Values are encrypted at
 * rest by the vault; the API is the only way in and never a way out.
 */
@Controller('core/secrets')
export class SecretsController {
  constructor(private readonly secrets: SecretResolver) {}

  /** Metadata for every stored secret (never values). */
  @RequireRole('admin')
  @Header('Cache-Control', 'no-store')
  @Get()
  list(): { secrets: SecretMetadata[]; writable: boolean } {
    const store = this.secrets.store;
    return { secrets: store.list(), writable: store.writable };
  }

  /** Presence + metadata for one secret (never the value). */
  @RequireRole('admin')
  @Header('Cache-Control', 'no-store')
  @Get(':name')
  get(@Param('name') name: string): SecretMetadata & { present: true } {
    this.requireName(name);
    const store = this.secrets.store;
    const metadata = store.list().find((entry) => entry.name === name);
    if (!metadata) throw new NotFoundException(`Unknown secret "${name}"`);
    return { ...metadata, present: true };
  }

  /** Create or rotate a secret. Returns metadata, never the value. */
  @RequireRole('admin')
  @Header('Cache-Control', 'no-store')
  @Put(':name')
  @HttpCode(200)
  put(@Param('name') name: string, @Body() dto: PutSecretDto): SecretMetadata {
    this.requireName(name);
    try {
      return this.secrets.store.put(name, dto.value);
    } catch (err) {
      throw this.mapStoreError(err, 'write failed');
    }
  }

  /** Delete a secret. Referencing servers/providers fail closed after. */
  @RequireRole('admin')
  @Header('Cache-Control', 'no-store')
  @Delete(':name')
  delete(@Param('name') name: string): { deleted: true } {
    this.requireName(name);
    let deleted: boolean;
    try {
      deleted = this.secrets.store.delete(name);
    } catch (err) {
      throw this.mapStoreError(err, 'delete failed');
    }
    if (!deleted) throw new NotFoundException(`Unknown secret "${name}"`);
    return { deleted: true };
  }

  private requireName(name: string): void {
    if (!isValidSecretName(name)) {
      throw new BadRequestException(`Invalid secret name "${name}"`);
    }
  }

  private mapStoreError(err: unknown, fallback: string): Error {
    const message = err instanceof Error ? err.message : fallback;
    return message.includes('disabled')
      ? new ConflictException(message)
      : new BadRequestException(message);
  }
}
