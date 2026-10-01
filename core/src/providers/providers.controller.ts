import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseFilters,
} from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { McpExceptionFilter } from '../mcp/mcp-exception.filter';
import { ProviderRegistryService } from './provider-registry.service';
import type { ProviderReport } from './provider-registry.service';
import { SetActiveProviderDto } from './dto/provider.dto';
import { ProviderDto } from './dto/provider.dto';
import type { ProviderRole } from './provider-catalog';

/**
 * LLM provider management (S4). Admin-only. Responses carry ids, models,
 * base URLs, and key presence — **never a key**. Reads are safe; the
 * mutations are `reload`, `active`, and a `test` that uses the resolved
 * key transiently without storing it.
 */
@Controller('core/providers')
@UseFilters(McpExceptionFilter)
export class ProvidersController {
  constructor(private readonly registry: ProviderRegistryService) {}

  @RequireRole('admin')
  @Get()
  list(): ProviderReport {
    return this.registry.report();
  }

  /** Catalog entries for the editor (references only, never values). */
  @RequireRole('admin')
  @Get('catalog')
  catalog(): {
    providers: ReturnType<ProviderRegistryService['catalogEntries']>;
  } {
    return { providers: this.registry.catalogEntries() };
  }

  /** Add or replace a provider, then reload without a restart. */
  @RequireRole('admin')
  @Put(':id')
  @HttpCode(200)
  upsert(@Param('id') id: string, @Body() dto: ProviderDto): ProviderReport {
    try {
      return this.registry.upsertProvider({ id, ...dto });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'invalid provider entry',
      );
    }
  }

  /** Remove a provider by id, then reload. */
  @RequireRole('admin')
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): ProviderReport {
    return this.registry.removeProvider(id);
  }

  @RequireRole('admin')
  @Post('reload')
  @HttpCode(200)
  reload(): ProviderReport {
    return this.registry.reload();
  }

  @RequireRole('admin')
  @Post('active')
  @HttpCode(200)
  setActive(@Body() dto: SetActiveProviderDto): ProviderReport {
    try {
      return this.registry.setActive(dto.role, dto.id);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'invalid provider',
      );
    }
  }

  @RequireRole('admin')
  @Post(':id/test')
  @HttpCode(200)
  async test(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const result = await this.registry.testConnection(id);
    if (!result.ok && result.detail.startsWith('unknown provider')) {
      throw new NotFoundException(result.detail);
    }
    return result;
  }
}

export type { ProviderRole };
