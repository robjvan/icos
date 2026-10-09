import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const TTL_MS = 10 * 60 * 1000;

/**
 * M17d.2 short-lived tokens for the tool-RPC bridge. An `execute_code` run
 * issues one token bound to its session; the script presents it to
 * `POST /core/tools/rpc`, which only executes approval-free tools in that
 * session. In-memory and single-session by construction; swept on issue.
 */
@Injectable()
export class ToolRpcTokens {
  private readonly tokens = new Map<
    string,
    { sessionId: string; expiresAt: number }
  >();

  issue(sessionId: string): string {
    this.sweep();
    const token = randomUUID();
    this.tokens.set(token, { sessionId, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  /** The owning session for a live token, or null. */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    const entry = this.tokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.sessionId;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token);
    }
  }
}
