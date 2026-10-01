import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
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
import { GetPromptDto } from './dto/mcp.dto';

/**
 * MCP operator surface (M13d/e). Read-only status, catalog reload,
 * and lazy read-only fetches of server resources and prompt
 * templates — no CRUD, no secret input, no auto-injection into
 * context (that is a future polish slice). Reads are
 * operator-initiated, so they carry no approval; tool execution
 * (writes) stays approval-gated (M13b). Every response is
 * name/state/reason/content only; secrets never cross this edge.
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

  /** Re-read the catalog without a restart; reports per-server results. */
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
