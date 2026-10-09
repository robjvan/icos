import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ToolRpcTokens } from './tool-rpc.tokens';
import { ToolRpcService } from './tool-rpc.service';
import type { ToolRpcResult } from './tool-rpc.service';

interface ToolRpcBody {
  tool?: unknown;
  args?: unknown;
}

/**
 * M17d.2 internal tool-RPC endpoint for `execute_code` scripts. Public at the
 * auth-guard level (the script has no admin cookie) but gated by a per-run
 * token; the owning session comes from the token, never the body.
 */
@Controller('core/tools')
export class ToolRpcController {
  constructor(
    private readonly tokens: ToolRpcTokens,
    private readonly rpc: ToolRpcService,
  ) {}

  @Public()
  @Post('rpc')
  @HttpCode(200)
  async call(
    @Headers('x-icos-rpc') token: string | undefined,
    @Body() body: ToolRpcBody,
  ): Promise<ToolRpcResult> {
    const sessionId = this.tokens.verify(token);
    if (!sessionId) return { ok: false, error: 'invalid_token' };
    if (!body || typeof body.tool !== 'string') {
      return { ok: false, error: 'invalid_request' };
    }
    const args =
      body.args !== null &&
      typeof body.args === 'object' &&
      !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    return this.rpc.call(sessionId, body.tool, args);
  }
}
