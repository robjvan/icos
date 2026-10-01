import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { RequireRole } from '../auth/decorators';
import { McpExceptionFilter } from '../mcp/mcp-exception.filter';
import { ProviderRegistryService } from './provider-registry.service';
import type { ProviderReport } from './provider-registry.service';
import { SetActiveProviderDto } from './dto/provider.dto';
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
