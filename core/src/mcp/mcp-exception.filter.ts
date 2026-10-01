import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { McpError } from './mcp-client';

/**
 * Map `McpError` to a 502 Bad Gateway (M13e). A down server, a
 * missing capability, or a timeout is an upstream failure the
 * operator should see plainly — not a generic 500. The message
 * carries the server name and the transport reason only (never
 * secrets; headers/env are never echoed).
 */
@Catch(McpError)
export class McpExceptionFilter implements ExceptionFilter {
  catch(exception: McpError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_GATEWAY).json({
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'Bad Gateway',
      message: exception.message,
    });
  }
}
