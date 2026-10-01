import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { McpConnectionService } from './mcp-connection.service';
import type {
  McpReloadReport,
  McpServerStatus,
} from './mcp-connection.service';

/**
 * MCP operator surface (M13d). Read-only status plus an explicit
 * catalog reload for the hand-edited catalog flow — no CRUD, no
 * secret input (that is a future polish slice). Both responses are
 * name/state/reason/tool-count only; secrets never cross this edge.
 */
@Controller('core/mcp')
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
}
