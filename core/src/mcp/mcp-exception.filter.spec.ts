import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { McpError } from './mcp-client';
import { McpExceptionFilter } from './mcp-exception.filter';

describe('McpExceptionFilter', () => {
  it('maps McpError to 502 with the transport message', () => {
    const status = jest.fn();
    const json = jest.fn();
    status.mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new McpExceptionFilter().catch(
      new McpError('MCP resources/list failed for "files": not supported'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'Bad Gateway',
      message: 'MCP resources/list failed for "files": not supported',
    });
  });
});
