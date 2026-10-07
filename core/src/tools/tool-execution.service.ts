import { isDeepStrictEqual } from 'node:util';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ApprovalRepository } from '../approvals/approval.repository';
import { ApprovalService } from '../approvals/approval.service';
import type { SessionStore } from '../conversation/session.store';
import type { LlmClient, StreamSink } from '../llm/llm.client';
import { ToolOffer } from '../llm/llm.protocol';
import type {
  LlmResult,
  LlmToolCall,
  LlmToolRequest,
} from '../llm/llm.protocol';
import { McpConnectionService } from '../mcp/mcp-connection.service';
import type { SkillService } from '../skills/skill.service';
import type { TodoRepository } from '../session/todo.repository';
import type {
  ChannelSendPort,
  ChannelSendRequest,
} from '../channels/channel-send.port';
import { ToolRegistry } from './tool-registry';
import type {
  ChannelSendArgs,
  ForeignToolCall,
  PatchArgs,
  ReadFileArgs,
  SearchFilesArgs,
  SkillViewArgs,
  TodoArgs,
  ValidatedToolRequest,
  WebExtractArgs,
  WebSearchArgs,
  WriteFileArgs,
} from './tool-registry';
import { ToolExecutionRepository } from './tool-execution.repository';
import type {
  ExecutionOutcome,
  ExecutionPair,
  FinalOutcome,
  McpOutcome,
  MirrorOutcomeState,
  NativeToolOutcome,
  ToolExecutionInput,
  ToolExecutionRecord,
  ValidationOutcome,
} from './tool-execution.repository';

export type { ToolExecutionInput } from './tool-execution.repository';

/** Approval action for foreign (MCP) tool execution. */
export const MCP_EXECUTE_ACTION = 'mcp.execute';

/** Approval action for a native channel.send. */
export const CHANNEL_SEND_ACTION = 'channel.send';

const MAX_RESULT_BYTES = 64 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_LINE_CHARS = 200;
const WEB_TIMEOUT_MS = 15_000;
const MAX_EXTRACT_CHARS = 32 * 1024;

/** Human-readable approval description for a channel.send proposal. */
function describeChannelSend(args: ChannelSendArgs): string {
  const to =
    args.target === 'operator'
      ? 'the operator'
      : `${args.target} ${args.id ?? ''}`.trim();
  return `Send a ${args.channel} message to ${to}: ${args.body.slice(0, 300)}`;
}

@Injectable()
export class ToolExecutionService {
  private readonly searchTimeoutMs: number;
  private readonly workspaceRoot: string;
  private readonly searxngBaseUrl: string | undefined;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly ledger: ToolExecutionRepository,
    private readonly sessions: Pick<SessionStore, 'searchMessages'>,
    private readonly registry: ToolRegistry,
    private readonly llm: Pick<LlmClient, 'chatWithTools'>,
    private readonly approvals: Pick<ApprovalRepository, 'getApproval'>,
    options: {
      searchTimeoutMs?: number;
      workspaceRoot?: string;
      searxngBaseUrl?: string;
    } = {},
    private readonly streamer:
      Pick<LlmClient, 'chatStreamWithTools'> | undefined,
    private readonly approvalService: ApprovalService,
    private readonly mcp: McpConnectionService,
    private readonly channels?: ChannelSendPort,
    private readonly skills?: SkillService,
    private readonly todos?: TodoRepository,
  ) {
    this.searchTimeoutMs = options.searchTimeoutMs ?? 2000;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.searxngBaseUrl = options.searxngBaseUrl;
    if (
      !Number.isInteger(this.searchTimeoutMs) ||
      this.searchTimeoutMs < 1 ||
      this.searchTimeoutMs > 10000
    )
      throw new Error('invalid_search_timeout');
  }

  async consume(
    input: ToolExecutionInput,
    options: {
      sink?: StreamSink;
      signal?: AbortSignal;
      skipFinal?: boolean;
    } = {},
  ): Promise<ToolExecutionRecord> {
    let snapshot: string;
    let captured: ToolExecutionInput;
    try {
      snapshot = JSON.stringify(input);
      captured = JSON.parse(snapshot) as ToolExecutionInput;
      if (!isDeepStrictEqual(input, captured)) throw new Error();
      if (
        !captured.requestId.trim() ||
        !captured.sessionId.trim() ||
        !Array.isArray(captured.allowedTools)
      )
        throw new Error();
    } catch {
      throw new Error('invalid_request');
    }
    // Foreign parking binds at birth (M13b): pure-validate first;
    // approval-required foreign calls mint their approval, then
    // register carries the binding into the INSERT (the ledger's
    // immutability trigger forbids binding afterwards). Existing
    // rows converge through register's idempotency — no second
    // approval is ever minted for a replay.
    let parkedApprovalId: string | null = null;
    if (!this.ledger.get(input.requestId)) {
      const preview = this.validate(input);
      if (preview.ok && 'request' in preview) {
        const descriptor = this.registry.lookup(preview.request.name);
        if (descriptor && descriptor.approval !== 'none') {
          const request = preview.request;
          const foreign = 'foreign' in request;
          const approval = await this.approvalService.create({
            sessionId: input.sessionId,
            action: foreign ? MCP_EXECUTE_ACTION : CHANNEL_SEND_ACTION,
            description: foreign
              ? `Execute foreign tool ${request.foreign.server}/` +
                `${request.foreign.tool} (${request.name}) ` +
                `with args ${JSON.stringify(request.args).slice(0, 500)}`
              : describeChannelSend(request.args as ChannelSendArgs),
          });
          parkedApprovalId = approval.id;
        }
      }
    }
    let record = this.ledger.register(
      snapshot,
      (saved) => this.validate(saved),
      parkedApprovalId ? { approvalId: parkedApprovalId } : undefined,
    );
    if (record.state === 'executing' && record.ownership === 'released') {
      this.ledger.resolveReleasedToUnknown(record.requestId);
      record = this.required(record.requestId);
    }
    if (record.state === 'validated') {
      const request =
        record.validation.ok && 'request' in record.validation
          ? record.validation.request
          : null;
      if (request && 'foreign' in request) {
        return this.consumeForeign(record, request, options);
      }
      // M17b: native approval-free tools other than the bespoke
      // search/rename/channel.send arms take the generic native path.
      if (
        request &&
        request.name !== 'session.search' &&
        request.name !== 'session.rename' &&
        request.name !== 'channel.send'
      ) {
        return this.consumeNative(record, request, options);
      }
      if (request?.name === 'session.rename') {
        record = this.renameInline(record);
      } else {
        const token = this.ledger.claimSearch(record.requestId, (saved) =>
          this.validate(saved),
        );
        if (token) {
          record = this.required(record.requestId);
          const searchPromise = this.search(record);
          const outcomePromise = searchPromise.then(
            (outcome) => ({ kind: 'outcome' as const, outcome }),
            (): { kind: 'outcome'; outcome: ExecutionOutcome } => ({
              kind: 'outcome',
              outcome: { ok: false, failure: { code: 'search_failed' } },
            }),
          );
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
            timeoutId = setTimeout(
              () => resolve({ kind: 'timeout' }),
              this.searchTimeoutMs,
            );
          });
          const winner = await Promise.race([outcomePromise, timeoutPromise]);
          if (winner.kind === 'outcome') {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            this.ledger.finishSearch(record.requestId, token, winner.outcome);
          } else {
            const background = outcomePromise.then(({ outcome }) => {
              try {
                this.ledger.finishSearch(record.requestId, token, outcome);
              } catch {
                // Leave the claim ambiguous; explicit release resolves it.
              }
            });
            const tracked = background.finally(() => {
              if (this.inFlight.get(record.requestId) === tracked)
                this.inFlight.delete(record.requestId);
            });
            this.inFlight.set(record.requestId, tracked);
            return this.required(record.requestId);
          }
        }
        record = this.required(record.requestId);
      }
    }
    if (record.state === 'awaiting_approval') {
      return this.resume(record.requestId, record.sessionId, options);
    }
    // Multi-step turns skip the tools-disabled final call on intermediate
    // steps; the driver finalizes the last step via resume(), which runs
    // the same guarded maybeFinal exactly once.
    if (options.skipFinal) {
      return this.required(record.requestId);
    }
    return this.maybeFinal(record.requestId, options);
  }

  /**
   * Foreign (MCP) validated path (M13b). Approval-required tools
   * arrive already parked (binding rides the INSERT); this handles
   * the approval-free inline path like rename-inline — claim,
   * execute, finish through the generic pair. A required-policy
   * row reaching here unparked is an invariant violation (loud,
   * never silently executed).
   */
  private async consumeForeign(
    record: ToolExecutionRecord,
    request: ForeignToolCall,
    options: {
      sink?: StreamSink;
      signal?: AbortSignal;
      skipFinal?: boolean;
    },
  ): Promise<ToolExecutionRecord> {
    const descriptor = this.registry.lookup(request.name);
    if (!descriptor || descriptor.approval !== 'none') {
      throw new Error('mcp_parking_bypassed');
    }
    const token = this.ledger.claimTool(record.requestId, (saved) =>
      this.validate(saved),
    );
    if (token) {
      await this.executeForeign(record.requestId, token);
    }
    if (options.skipFinal) {
      return this.required(record.requestId);
    }
    return this.maybeFinal(record.requestId, options);
  }

  /**
   * Native (approval-free) inline path (M17b). Claim, execute through the
   * native dispatcher, then finish with a generic outcome — the same shape
   * contract as the foreign path.
   */
  private async consumeNative(
    record: ToolExecutionRecord,
    request: ValidatedToolRequest,
    options: {
      sink?: StreamSink;
      signal?: AbortSignal;
      skipFinal?: boolean;
    },
  ): Promise<ToolExecutionRecord> {
    const descriptor = this.registry.lookup(request.name);
    if (!descriptor || descriptor.approval !== 'none') {
      throw new Error('native_parking_bypassed');
    }
    const token = this.ledger.claimNativeTool(record.requestId, (saved) =>
      this.validate(saved),
    );
    if (token) {
      await this.executeNativeTool(record.requestId, token);
    }
    if (options.skipFinal) {
      return this.required(record.requestId);
    }
    return this.maybeFinal(record.requestId, options);
  }

  /** Execute one claimed native call through the native dispatcher. */
  private async executeNativeTool(
    requestId: string,
    token: string,
  ): Promise<void> {
    const claimed = this.required(requestId);
    const validation = claimed.validation;
    if (
      !validation.ok ||
      !('request' in validation) ||
      'foreign' in validation.request
    ) {
      throw new Error('invalid_execution_state');
    }
    const name = validation.request.name;
    let outcome: NativeToolOutcome;
    try {
      const result = await this.dispatchNative(
        name,
        validation.request.args as unknown as Record<string, unknown>,
        claimed.sessionId,
      );
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES) {
        outcome = { ok: false, failure: { code: 'result_too_large' } };
      } else {
        outcome = {
          ok: true,
          tool: name,
          result: JSON.parse(serialized) as unknown,
        };
      }
    } catch (error) {
      outcome = {
        ok: false,
        failure: {
          code:
            error instanceof Error && error.message === 'result_too_large'
              ? 'result_too_large'
              : 'tool_failed',
        },
      };
    }
    this.ledger.finishTool(requestId, token, outcome);
  }

  /** Dispatch a native tool by name (M17b). */
  private dispatchNative(
    name: string,
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<unknown> {
    switch (name) {
      case 'read_file':
        return Promise.resolve(
          this.nativeReadFile(args as unknown as ReadFileArgs),
        );
      case 'search_files':
        return Promise.resolve(
          this.nativeSearchFiles(args as unknown as SearchFilesArgs),
        );
      case 'write_file':
        return Promise.resolve(
          this.nativeWriteFile(args as unknown as WriteFileArgs),
        );
      case 'patch':
        return Promise.resolve(this.nativePatch(args as unknown as PatchArgs));
      case 'web_search':
        return this.nativeWebSearch(args as unknown as WebSearchArgs);
      case 'web_extract':
        return this.nativeWebExtract(args as unknown as WebExtractArgs);
      case 'skills_list':
        return Promise.resolve(this.nativeSkillsList());
      case 'skill_view':
        return this.nativeSkillView(args as unknown as SkillViewArgs);
      case 'todo':
        return this.nativeTodo(args as unknown as TodoArgs, sessionId);
      default:
        return Promise.reject(new Error(`unknown_native_tool: ${name}`));
    }
  }

  /** Read a bounded UTF-8 file, confined to the workspace root. */
  private nativeReadFile(args: ReadFileArgs): unknown {
    const file = this.resolveWithinWorkspace(args.path);
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error('not_a_file');
    const maxBytes = args.maxBytes ?? MAX_RESULT_BYTES;
    const content = readFileSync(file, 'utf8');
    const truncated = Buffer.byteLength(content) > maxBytes;
    return {
      path: args.path,
      bytes: stat.size,
      truncated,
      content: truncated ? content.slice(0, maxBytes) : content,
    };
  }

  /** Search file contents under the workspace, bounded. */
  private nativeSearchFiles(args: SearchFilesArgs): unknown {
    const root = this.resolveWithinWorkspace(args.path ?? '.');
    const maxResults = args.maxResults ?? 20;
    let pattern: RegExp;
    try {
      pattern = new RegExp(args.query, 'i');
    } catch {
      pattern = new RegExp(
        args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
    }
    const matches: { path: string; line: number; text: string }[] = [];
    const walk = (dir: string): void => {
      if (matches.length >= maxResults) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(join(dir, entry.name));
        } else if (entry.isFile()) {
          this.searchOneFile(
            join(dir, entry.name),
            root,
            pattern,
            matches,
            maxResults,
          );
        }
      }
    };
    walk(root);
    return { query: args.query, matches };
  }

  private searchOneFile(
    full: string,
    root: string,
    pattern: RegExp,
    matches: { path: string; line: number; text: string }[],
    maxResults: number,
  ): void {
    let content: string;
    try {
      if (statSync(full).size > MAX_SEARCH_FILE_BYTES) return;
      content = readFileSync(full, 'utf8');
    } catch {
      return;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      const line = lines[i];
      if (line !== undefined && pattern.test(line)) {
        matches.push({
          path: relative(root, full),
          line: i + 1,
          text: line.slice(0, MAX_SEARCH_LINE_CHARS),
        });
      }
    }
  }

  /** Write (or overwrite) a workspace file, creating parent directories. */
  private nativeWriteFile(args: WriteFileArgs): unknown {
    const file = this.resolveWithinWorkspace(args.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, args.content, 'utf8');
    return { path: args.path, bytes: Buffer.byteLength(args.content) };
  }

  /** Replace an exact string in a workspace file (unique unless replaceAll). */
  private nativePatch(args: PatchArgs): unknown {
    const file = this.resolveWithinWorkspace(args.path);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      throw new Error('not_a_file');
    }
    const count = content.split(args.oldString).length - 1;
    if (count === 0) throw new Error('old_string_not_found');
    if (count > 1 && args.replaceAll !== true) {
      throw new Error('old_string_not_unique');
    }
    const next =
      args.replaceAll === true
        ? content.split(args.oldString).join(args.newString)
        : content.replace(args.oldString, args.newString);
    writeFileSync(file, next, 'utf8');
    return {
      path: args.path,
      replacements: args.replaceAll === true ? count : 1,
    };
  }

  /** Search the web through the configured SearXNG instance. */
  private async nativeWebSearch(args: WebSearchArgs): Promise<unknown> {
    const base = this.searxngBaseUrl;
    if (!base) throw new Error('web_search_unavailable');
    const limit = args.maxResults ?? 5;
    const url = new URL('search', base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('q', args.query);
    url.searchParams.set('format', 'json');
    const response = await fetchWithTimeout(url.toString(), WEB_TIMEOUT_MS);
    if (!response.ok) throw new Error('web_search_failed');
    const data = (await response.json()) as {
      results?: { title?: unknown; url?: unknown; content?: unknown }[];
    };
    const results = (Array.isArray(data.results) ? data.results : [])
      .slice(0, limit)
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title.slice(0, 300) : '',
        url: typeof r.url === 'string' ? r.url : '',
        snippet: typeof r.content === 'string' ? r.content.slice(0, 500) : '',
      }))
      .filter((r) => r.url !== '');
    return { query: args.query, results };
  }

  /** Fetch a web page and return its readable text (bounded). */
  private async nativeWebExtract(args: WebExtractArgs): Promise<unknown> {
    const target = new URL(args.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('invalid_url');
    }
    const maxBytes = args.maxBytes ?? MAX_EXTRACT_CHARS;
    const response = await fetchWithTimeout(args.url, WEB_TIMEOUT_MS);
    if (!response.ok) throw new Error('web_extract_failed');
    const html = (await response.text()).slice(0, maxBytes);
    const text = htmlToText(html);
    const truncated = text.length > MAX_EXTRACT_CHARS;
    return {
      url: args.url,
      text: truncated ? text.slice(0, MAX_EXTRACT_CHARS) : text,
      truncated,
    };
  }

  /** List the available skills (name, description, version). */
  private nativeSkillsList(): unknown {
    if (!this.skills) throw new Error('skills_unavailable');
    return {
      skills: this.skills.listDescriptors().map((d) => ({
        name: d.name,
        description: d.description,
        version: d.version,
      })),
    };
  }

  /** Read a skill's full instructions by name. */
  private async nativeSkillView(args: SkillViewArgs): Promise<unknown> {
    if (!this.skills) throw new Error('skills_unavailable');
    const skill = await this.skills.loadBody(args.name);
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      body: skill.body,
    };
  }

  /** Per-session todo list (M17b). */
  private async nativeTodo(
    args: TodoArgs,
    sessionId: string,
  ): Promise<unknown> {
    if (!this.todos) throw new Error('todos_unavailable');
    switch (args.action) {
      case 'list':
        return { todos: await this.todos.list(sessionId) };
      case 'add':
        return { todo: await this.todos.add(sessionId, args.text) };
      case 'complete': {
        const todo = await this.todos.complete(sessionId, args.id);
        if (!todo) throw new Error('todo_not_found');
        return { todo };
      }
      case 'remove': {
        const removed = await this.todos.remove(sessionId, args.id);
        if (!removed) throw new Error('todo_not_found');
        return { removed: true };
      }
      case 'clear':
        return { cleared: await this.todos.clear(sessionId) };
    }
  }

  /**
   * Resolve a tool path against the workspace root and refuse anything that
   * escapes it (M17b). For a not-yet-existing path (a write target), the
   * deepest existing ancestor is resolved, so a symlinked parent cannot point
   * out; the remaining segments cannot be symlinks yet.
   */
  private resolveWithinWorkspace(input: string): string {
    const root = realpathSync(this.workspaceRoot);
    const candidate = resolve(root, input);
    let probe = candidate;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const realAncestor = existsSync(probe) ? realpathSync(probe) : root;
    const rel = relative(root, realAncestor);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('path_outside_workspace');
    }
    return candidate;
  }

  /** Execute one claimed foreign call through its MCP server. */
  private async executeForeign(
    requestId: string,
    token: string,
  ): Promise<void> {
    const claimed = this.required(requestId);
    const validation = claimed.validation;
    if (
      !validation.ok ||
      !('request' in validation) ||
      !('foreign' in validation.request)
    ) {
      throw new Error('invalid_execution_state');
    }
    const { server, tool } = validation.request.foreign;
    const args = validation.request.args;
    let outcome: McpOutcome;
    try {
      const result = await this.mcp.callTool(server, tool, args);
      if (Buffer.byteLength(result.text) > MAX_RESULT_BYTES) {
        outcome = { ok: false, failure: { code: 'result_too_large' } };
      } else if (result.isError) {
        outcome = { ok: false, failure: { code: 'mcp_failed' } };
      } else {
        outcome = { ok: true, mcp: { server, tool, text: result.text } };
      }
    } catch {
      outcome = { ok: false, failure: { code: 'mcp_failed' } };
    }
    this.ledger.finishTool(requestId, token, outcome);
  }

  /** Execute one claimed native channel.send through the channel port. */
  private async executeChannelSend(
    requestId: string,
    token: string,
  ): Promise<void> {
    const claimed = this.required(requestId);
    const validation = claimed.validation;
    if (
      !validation.ok ||
      !('request' in validation) ||
      validation.request.name !== 'channel.send' ||
      'foreign' in validation.request
    ) {
      throw new Error('invalid_execution_state');
    }
    const args: ChannelSendArgs = validation.request.args;
    if (!this.channels) {
      this.ledger.finishChannelSend(requestId, token, {
        ok: false,
        failure: { code: 'channel_unavailable' },
      });
      return;
    }
    const request: ChannelSendRequest = {
      channel: args.channel,
      target: args.target,
      ...(args.id !== undefined ? { id: args.id } : {}),
      body: args.body,
    };
    try {
      const result = await this.channels.send(request);
      this.ledger.finishChannelSend(requestId, token, {
        ok: true,
        channelSend: {
          messageId: result.messageId,
          deliveryId: result.deliveryId,
        },
      });
    } catch {
      this.ledger.finishChannelSend(requestId, token, {
        ok: false,
        failure: { code: 'channel_failed' },
      });
    }
  }

  /**
   * Inline rename execution (approval-free policy). Claims the
   * validated record, applies the local title mutation, and persists
   * the outcome — the same claim/finish pair as the resume path,
   * minus the approval gate.
   */
  private renameInline(record: ToolExecutionRecord): ToolExecutionRecord {
    const token = this.ledger.claimRenameInline(record.requestId, (saved) =>
      this.validate(saved),
    );
    if (token) {
      const claimed = this.required(record.requestId);
      const validation = claimed.validation;
      if (
        validation.ok &&
        'request' in validation &&
        validation.request.name === 'session.rename' &&
        !('foreign' in validation.request)
      ) {
        this.ledger.finishRename(claimed.requestId, token, {
          sessionId: claimed.sessionId,
          title: validation.request.args.title,
        });
      }
    }
    return this.required(record.requestId);
  }

  /**
   * Resume an invocation parked at `awaiting_approval`. The caller must
   * present the owning session: a forked session id is denied, so a
   * fork never inherits executable pending approvals. Generic
   * approvals and approvals bound to other invocations confer zero
   * authority — only the stored `approvalId` in `approved` state
   * executes, exactly once.
   */
  async resume(
    requestId: string,
    sessionId: string,
    options: {
      sink?: StreamSink;
      signal?: AbortSignal;
      skipFinal?: boolean;
    } = {},
  ): Promise<ToolExecutionRecord> {
    const record = this.required(requestId);
    if (record.sessionId !== sessionId) throw new Error('invalid_session');
    if (record.state === 'awaiting_approval' && record.approvalId) {
      const approval = await this.approvals.getApproval(record.approvalId);
      if (
        approval &&
        approval.sessionId === record.sessionId &&
        approval.id === record.approvalId
      ) {
        if (approval.status === 'approved') {
          const validated = record.validation;
          if (
            validated.ok &&
            'request' in validated &&
            'foreign' in validated.request
          ) {
            const token = this.ledger.claimApprovedTool(requestId, (saved) =>
              this.validate(saved),
            );
            if (token) {
              await this.executeForeign(requestId, token);
            }
          } else if (
            validated.ok &&
            'request' in validated &&
            validated.request.name === 'channel.send'
          ) {
            const token = this.ledger.claimChannelSend(requestId, (saved) =>
              this.validate(saved),
            );
            if (token) {
              await this.executeChannelSend(requestId, token);
            }
          } else {
            const token = this.ledger.claimRename(requestId, (saved) =>
              this.validate(saved),
            );
            if (token) {
              const claimed = this.required(requestId);
              if (
                !claimed.validation.ok ||
                !('request' in claimed.validation) ||
                claimed.validation.request.name !== 'session.rename' ||
                'foreign' in claimed.validation.request
              )
                throw new Error('invalid_execution_state');
              this.ledger.finishRename(requestId, token, {
                sessionId: claimed.sessionId,
                title: claimed.validation.request.args.title,
              });
            }
          }
        } else if (approval.status !== 'pending') {
          const outcome: MirrorOutcomeState = approval.status;
          this.ledger.mirrorOutcome(requestId, outcome);
        }
      }
    }
    // Post-approval continuation defers the tools-disabled final call;
    // the driver finalizes the last step through this same path.
    if (options.skipFinal) {
      return this.required(requestId);
    }
    return this.maybeFinal(requestId, options);
  }

  /** Durable completed pairs for conversation context reconstruction. */
  recentPairs(sessionId: string, limit: number): ExecutionPair[] {
    return this.ledger.recentExecutions(sessionId, limit);
  }

  /** Claim the single transcript write for a request (see ledger). */
  claimTranscript(requestId: string): boolean {
    return this.ledger.claimTranscript(requestId);
  }

  private async maybeFinal(
    requestId: string,
    options: { sink?: StreamSink; signal?: AbortSignal } = {},
  ): Promise<ToolExecutionRecord> {
    const record = this.required(requestId);
    if (
      (record.state === 'succeeded' || record.state === 'failed') &&
      record.final.state === 'pending'
    ) {
      const token = this.ledger.claimFinal(requestId);
      if (token) {
        const durable = this.required(requestId);
        const outcome = await this.respond(durable, options);
        this.ledger.finishFinal(requestId, token, outcome);
      }
    }
    return this.required(requestId);
  }

  private validate(input: ToolExecutionInput): ValidationOutcome {
    try {
      new ToolOffer({ messages: input.context, tools: [], toolChoice: 'none' });
    } catch {
      return { ok: false, failure: { code: 'invalid_context' } };
    }
    const proposal = input.proposal;
    if (
      !proposal ||
      typeof proposal !== 'object' ||
      typeof proposal.model !== 'string' ||
      !proposal.model.trim() ||
      (proposal.content !== null && typeof proposal.content !== 'string') ||
      (proposal.kind === 'text' && !proposal.content?.trim())
    )
      return { ok: false, failure: { code: 'invalid_proposal' } };
    if (proposal.kind === 'text') {
      if (
        typeof proposal.content !== 'string' ||
        'toolCalls' in proposal ||
        'tool_calls' in proposal
      )
        return { ok: false, failure: { code: 'invalid_proposal' } };
      return { ok: true, textOnly: true };
    }
    if (proposal.kind !== 'tool_calls' || !Array.isArray(proposal.toolCalls))
      return { ok: false, failure: { code: 'invalid_proposal' } };
    if (proposal.toolCalls.length !== 1)
      return { ok: false, failure: { code: 'invalid_call_count' } };
    const call = proposal.toolCalls[0] as LlmToolCall;
    const validation = this.registry.validate(
      { name: call.name, version: call.version, args: call.args },
      { sessionId: input.sessionId, allowedTools: input.allowedTools },
    );
    if (!validation.ok)
      return { ok: false, failure: { code: validation.failure.code } };
    const descriptor = this.registry.lookup(validation.request.name);
    // Native tools are approval-free except channel.send (approval-required,
    // parked in consume). Anything else native requiring approval fails
    // closed here. Foreign required-approval tools pass through —
    // consumeForeign parks them with a minted approval.
    const nativeApprovalTool =
      !('foreign' in validation.request) &&
      validation.request.name === 'channel.send';
    if (
      descriptor?.approval !== 'none' &&
      !('foreign' in validation.request) &&
      !nativeApprovalTool
    )
      return { ok: false, failure: { code: 'unpermitted_tool' } };
    try {
      if (
        typeof call.rawArguments !== 'string' ||
        Buffer.byteLength(call.rawArguments) > MAX_RESULT_BYTES ||
        !isDeepStrictEqual(JSON.parse(call.rawArguments) as unknown, call.args)
      )
        return { ok: false, failure: { code: 'argument_mismatch' } };
    } catch {
      return { ok: false, failure: { code: 'argument_mismatch' } };
    }
    return validation;
  }

  private async search(record: ToolExecutionRecord): Promise<ExecutionOutcome> {
    const validation = record.validation;
    if (
      !validation.ok ||
      !('request' in validation) ||
      validation.request.name !== 'session.search' ||
      'foreign' in validation.request
    )
      throw new Error('invalid_execution_state');
    try {
      const matches = await this.sessions.searchMessages(
        validation.request.args.query,
        {
          sessionId: record.sessionId,
          limit: validation.request.args.limit,
        },
      );
      const outcome: ExecutionOutcome = { ok: true, matches };
      const serialized = JSON.stringify(outcome);
      if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES)
        return { ok: false, failure: { code: 'result_too_large' } };
      return JSON.parse(serialized) as ExecutionOutcome;
    } catch {
      return { ok: false, failure: { code: 'search_failed' } };
    }
  }

  private async respond(
    record: ToolExecutionRecord,
    options: { sink?: StreamSink; signal?: AbortSignal } = {},
  ): Promise<Extract<FinalOutcome, { state: 'succeeded' | 'failed' }>> {
    const proposal = record.input.proposal;
    if (
      proposal.kind !== 'tool_calls' ||
      !record.invocationId ||
      !record.execution
    )
      throw new Error('invalid_final_state');
    const request: LlmToolRequest = {
      sessionId: record.sessionId,
      messages: [
        ...record.input.context,
        {
          role: 'assistant',
          content: proposal.content,
          toolCalls: [{ ...proposal.toolCalls[0], id: record.invocationId }],
          ...(typeof proposal.reasoningContent === 'string' &&
          proposal.reasoningContent.length > 0
            ? { reasoningContent: proposal.reasoningContent }
            : {}),
        },
        {
          role: 'tool',
          callId: record.invocationId,
          content: JSON.stringify(record.execution),
        },
      ],
      tools: [],
      toolChoice: 'none',
    };
    let result: LlmResult;
    try {
      result =
        options.sink && this.streamer
          ? await this.streamer.chatStreamWithTools(
              request,
              options.sink,
              options.signal,
            )
          : await this.llm.chatWithTools(request);
    } catch {
      return { state: 'failed', failure: { code: 'llm_failed' } };
    }
    if (
      !result ||
      result.kind !== 'text' ||
      typeof result.content !== 'string' ||
      !result.content.trim() ||
      typeof result.model !== 'string' ||
      'toolCalls' in result ||
      'tool_calls' in result
    )
      return { state: 'failed', failure: { code: 'invalid_final' } };
    const text: Extract<LlmResult, { kind: 'text' }> = {
      kind: 'text',
      content: result.content,
      model: result.model,
    };
    if (Buffer.byteLength(JSON.stringify(text)) > MAX_RESULT_BYTES)
      return { state: 'failed', failure: { code: 'final_too_large' } };
    return { state: 'succeeded', result: text };
  }

  private required(requestId: string): ToolExecutionRecord {
    const record = this.ledger.get(requestId);
    if (!record) throw new Error('request_not_found');
    return record;
  }
}

/** fetch with a hard timeout; throws on abort or transport error. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crude HTML → text (M17b): drop script/style/comments, strip tags, decode a
 * few common entities, collapse whitespace. Bounded by the caller.
 */
function htmlToText(html: string): string {
  const without = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return without
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
