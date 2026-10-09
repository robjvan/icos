import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ToolRegistry } from './tool-registry';
import { ToolExecutionService } from './tool-execution.service';

export interface ToolRpcResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * M17d.2 tool-RPC bridge. A script run by `execute_code` calls back into the
 * core to invoke tools. Only **approval-free** tools are reachable this way —
 * an approval-gated tool is rejected (a script cannot approve for the
 * operator), and the session binding comes from the token, never the request.
 */
@Injectable()
export class ToolRpcService {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly tools: ToolExecutionService,
  ) {}

  async call(
    sessionId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ToolRpcResult> {
    const descriptor = this.registry.lookup(tool);
    if (!descriptor) return { ok: false, error: 'unknown_tool' };
    if (descriptor.approval !== 'none') {
      return { ok: false, error: 'requires_approval' };
    }
    const requestId = randomUUID();
    try {
      const record = await this.tools.consume(
        {
          requestId,
          sessionId,
          context: [],
          allowedTools: this.registry.list().map((d) => d.name),
          proposal: {
            kind: 'tool_calls',
            content: null,
            model: 'rpc',
            toolCalls: [
              {
                id: requestId,
                name: tool,
                version: 1,
                rawArguments: JSON.stringify(args),
                args,
              },
            ],
          },
        },
        { skipFinal: true },
      );
      if (record.state === 'succeeded' && record.execution) {
        return { ok: true, result: record.execution };
      }
      return { ok: false, error: record.state };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'rpc_failed',
      };
    }
  }
}
