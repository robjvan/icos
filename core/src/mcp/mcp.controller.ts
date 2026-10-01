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
  Query,
  UseFilters,
} from '@nestjs/common';
import { McpConnectionService } from './mcp-connection.service';
import type {
  McpReloadReport,
  McpServerStatus,
} from './mcp-connection.service';
import type {
  McpPrompt,
  McpPromptResult,
  McpResource,
  McpResourceRead,
} from './mcp-client';
import { McpExceptionFilter } from './mcp-exception.filter';
import { RequireRole } from '../auth/decorators';
import type { McpServerEntry } from './mcp-server-config';
import { McpServerDto } from './dto/mcp-server.dto';
import { GetPromptDto } from './dto/mcp.dto';

/**
 * MCP operator surface (M13d/e, M13f security S5). Read-only status,
 * lazy resource/prompt fetches, and admin catalog CRUD. Entries hold
 * references (`$VAR`/`secret:NAME`), never values — no secret crosses
 * this edge. Config mutation is admin-only and CSRF-gated by the global
 * guard.
 *
 * Error contract: unknown server → 404; down server / missing
 * capability / timeout (`McpError`) → 502 via the filter; bad input
 * → 400.
 */
@Controller('core/mcp')
@UseFilters(McpExceptionFilter)
export class McpController {
  constructor(private readonly connections: McpConnectionService) {}

  /** Per-server connection state (same data as the health surface). */
  @Get('servers')
  servers(): { servers: McpServerStatus[] } {
    return { servers: this.connections.statusAll() };
  }

  /** Catalog entries for the editor (references only, never values). */
  @RequireRole('admin')
  @Get('catalog')
  catalog(): { servers: McpServerEntry[] } {
    return { servers: this.connections.catalogEntries() };
  }

  /** Add or replace a server, then reconcile without a restart. */
  @RequireRole('admin')
  @Put('servers/:name')
  @HttpCode(200)
  async upsert(
    @Param('name') name: string,
    @Body() dto: McpServerDto,
  ): Promise<McpReloadReport> {
    try {
      return await this.connections.upsertServerEntry({ name, ...dto });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'invalid server entry',
      );
    }
  }

  /** Remove a server by name, then reconcile. */
  @RequireRole('admin')
  @Delete('servers/:name')
  @HttpCode(200)
  remove(@Param('name') name: string): Promise<McpReloadReport> {
    return this.connections.removeServerEntry(name);
  }

  /** Re-read the catalog without a restart; reports per-server results. */
  @RequireRole('admin')
  @Post('reload')
  @HttpCode(200)
  reload(): Promise<McpReloadReport> {
    return this.connections.reload();
  }

  /** Read-only resource catalog of one connected server (lazy). */
  @Get('servers/:name/resources')
  async resources(@Param('name') name: string): Promise<{
    resources: McpResource[];
  }> {
    this.requireKnown(name);
    return { resources: await this.connections.listResources(name) };
  }

  /** Fetch one resource by URI (text capped; binary flagged, not embedded). */
  @Get('servers/:name/resources/read')
  readResource(
    @Param('name') name: string,
    @Query('uri') uri: string,
  ): Promise<McpResourceRead> {
    this.requireKnown(name);
    if (typeof uri !== 'string' || !uri.trim()) {
      throw new BadRequestException('uri query parameter is required');
    }
    return this.connections.readResource(name, uri.trim());
  }

  /** Prompt templates one connected server offers (lazy, no injection). */
  @Get('servers/:name/prompts')
  async prompts(@Param('name') name: string): Promise<{
    prompts: McpPrompt[];
  }> {
    this.requireKnown(name);
    return { prompts: await this.connections.listPrompts(name) };
  }

  /** Fetch one prompt template, optionally with named arguments. */
  @Post('servers/:name/prompts/:prompt')
  @HttpCode(200)
  getPrompt(
    @Param('name') name: string,
    @Param('prompt') prompt: string,
    @Body() body: GetPromptDto,
  ): Promise<McpPromptResult> {
    this.requireKnown(name);
    const args = body.arguments ?? {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(
          `prompt argument "${key}" must be a string`,
        );
      }
    }
    return this.connections.getPrompt(name, prompt, args);
  }

  /** Unknown servers are a client error, not an upstream failure. */
  private requireKnown(name: string): void {
    if (this.connections.statusOf(name) === null) {
      throw new NotFoundException(`Unknown MCP server "${name}"`);
    }
  }
}
