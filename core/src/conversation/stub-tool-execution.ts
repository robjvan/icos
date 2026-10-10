import type { StreamSink } from '../llm/llm.client';
import type { LlmResult, LlmToolRequest } from '../llm/llm.protocol';
import type { ForeignToolName } from '../tools/tool-registry';
import type {
  AgentRun,
  AgentRunRepository,
} from '../agent/agent-run.repository';
import type {
  ExecutionPair,
  ToolExecutionInput,
  ToolExecutionRecord,
  ValidationOutcome,
} from '../tools/tool-execution.repository';
import type { ToolExecutionService } from '../tools/tool-execution.service';

/** Shared conversation-spec doubles for the M8 tool substrate. */

export function textProposal(
  content = 'hi back',
  model = 'm',
): Extract<LlmResult, { kind: 'text' }> {
  return { kind: 'text', content, model };
}

export function searchProposal(
  query = 'teal',
  limit = 20,
): Extract<LlmResult, { kind: 'tool_calls' }> {
  const rawArguments = JSON.stringify({ query, limit });
  return {
    kind: 'tool_calls',
    content: null,
    model: 'm',
    toolCalls: [
      {
        id: 'model-call-1',
        name: 'session.search',
        version: 1,
        rawArguments,
        args: { query, limit },
      },
    ],
  };
}

export function searchPlatformToolsProposal(
  query = 'read file',
): Extract<LlmResult, { kind: 'tool_calls' }> {
  const args = { query };
  return {
    kind: 'tool_calls',
    content: null,
    model: 'm',
    toolCalls: [
      {
        id: 'model-call-1',
        name: 'search_platform_tools',
        version: 1,
        rawArguments: JSON.stringify(args),
        args,
      },
    ],
  };
}

export function renameProposal(
  title = 'New title',
): Extract<LlmResult, { kind: 'tool_calls' }> {
  const rawArguments = JSON.stringify({ title });
  return {
    kind: 'tool_calls',
    content: null,
    model: 'm',
    toolCalls: [
      {
        id: 'model-call-1',
        name: 'session.rename',
        version: 1,
        rawArguments,
        args: { title },
      },
    ],
  };
}

export function clarifyProposal(
  question = 'Which one?',
  options: string[] = ['a', 'b'],
): Extract<LlmResult, { kind: 'tool_calls' }> {
  const args = { question, options };
  return {
    kind: 'tool_calls',
    content: null,
    model: 'm',
    toolCalls: [
      {
        id: 'model-call-1',
        name: 'clarify',
        version: 1,
        rawArguments: JSON.stringify(args),
        args,
      },
    ],
  };
}

/** Closed text record mirroring the proposal, as the ledger would. */
export function closedTextRecord(
  input: ToolExecutionInput,
): ToolExecutionRecord {
  if (input.proposal.kind !== 'text') {
    throw new Error('closedTextRecord needs a text proposal');
  }
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: null,
    approvalId: null,
    clarificationId: null,
    state: 'closed',
    validation: { ok: true, textOnly: true },
    execution: null,
    final: { state: 'not_required', result: input.proposal },
    executionToken: null,
    ownership: 'none',
  };
}

export function searchRecord(
  input: ToolExecutionInput,
  result: string,
): ToolExecutionRecord {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: 'inv-search-1',
    approvalId: null,
    clarificationId: null,
    state: 'succeeded',
    validation: {
      ok: true,
      request: {
        name: 'session.search',
        version: 1,
        sessionId: input.sessionId,
        args: { query: 'teal', limit: 20 },
      },
    },
    execution: { ok: true, matches: [] },
    final: {
      state: 'succeeded',
      result: { kind: 'text', content: result, model: 'm' },
    },
    executionToken: null,
    ownership: 'none',
  };
}

export function pendingRenameRecord(
  input: ToolExecutionInput,
): ToolExecutionRecord {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: 'inv-rename-1',
    approvalId: 'appr-1',
    clarificationId: null,
    state: 'awaiting_approval',
    validation: {
      ok: true,
      request: {
        name: 'session.rename',
        version: 1,
        sessionId: input.sessionId,
        args: { title: 'New title' },
      },
    },
    execution: null,
    final: { state: 'not_required' },
    executionToken: null,
    ownership: 'none',
  };
}

export function pendingClarifyRecord(
  input: ToolExecutionInput,
): ToolExecutionRecord {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: 'inv-clarify-1',
    approvalId: null,
    clarificationId: 'clar-1',
    state: 'awaiting_clarification',
    validation: {
      ok: true,
      request: {
        name: 'clarify',
        version: 1,
        sessionId: input.sessionId,
        args: { question: 'Which one?', options: ['a', 'b'] },
      },
    },
    execution: null,
    final: { state: 'not_required' },
    executionToken: null,
    ownership: 'none',
  };
}

export function answeredClarifyRecord(
  input: ToolExecutionInput,
  answer = 'a',
): ToolExecutionRecord {
  return {
    ...pendingClarifyRecord(input),
    state: 'succeeded',
    execution: {
      ok: true,
      tool: 'clarify',
      result: { question: 'Which one?', answer, options: ['a', 'b'] },
    },
    final: { state: 'pending' },
  };
}

/** Foreign (MCP) doubles for the M13c loop matrix. */

export function foreignProposal(
  args: Record<string, unknown> = { path: '/x' },
  name: ForeignToolName = 'mcp_files_read',
): Extract<LlmResult, { kind: 'tool_calls' }> {
  const rawArguments = JSON.stringify(args);
  return {
    kind: 'tool_calls',
    content: null,
    model: 'm',
    toolCalls: [
      { id: 'model-call-foreign', name, version: 1, rawArguments, args },
    ],
  };
}

export function pendingForeignRecord(
  input: ToolExecutionInput,
  options: {
    name?: ForeignToolName;
    server?: string;
    tool?: string;
    args?: Record<string, unknown>;
  } = {},
): ToolExecutionRecord {
  const name = options.name ?? 'mcp_files_read';
  const server = options.server ?? 'files';
  const tool = options.tool ?? 'read';
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: 'inv-foreign-1',
    approvalId: 'appr-foreign-1',
    clarificationId: null,
    state: 'awaiting_approval',
    validation: {
      ok: true,
      request: {
        name,
        version: 1,
        sessionId: input.sessionId,
        args: options.args ?? { path: '/x' },
        foreign: { server, tool },
      },
    },
    execution: null,
    final: { state: 'not_required' },
    executionToken: null,
    ownership: 'none',
  };
}

export function foreignSuccessRecord(
  input: ToolExecutionInput,
  text = 'file says hi',
): ToolExecutionRecord {
  const pending = pendingForeignRecord(input);
  return {
    ...pending,
    state: 'succeeded',
    execution: {
      ok: true,
      mcp: { server: 'files', tool: 'read', text },
    },
    final: {
      state: 'succeeded',
      result: { kind: 'text', content: text, model: 'm' },
    },
  };
}

export type InvalidFailureCode = Extract<
  ValidationOutcome,
  { ok: false }
>['failure']['code'];

export function invalidRecord(
  input: ToolExecutionInput,
  code: InvalidFailureCode = 'unknown_tool',
): ToolExecutionRecord {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    input,
    invocationId: 'inv-bad-1',
    approvalId: null,
    clarificationId: null,
    state: 'invalid',
    validation: { ok: false, failure: { code } },
    execution: null,
    final: { state: 'not_required' },
    executionToken: null,
    ownership: 'none',
  };
}

export function executingRecord(
  input: ToolExecutionInput,
): ToolExecutionRecord {
  return {
    ...searchRecord(input, ''),
    state: 'executing',
    execution: null,
    final: { state: 'not_required' },
  };
}

export function stubToolExecution() {
  const consume = jest.fn<Promise<ToolExecutionRecord>, [ToolExecutionInput]>(
    (input) => Promise.resolve(closedTextRecord(input)),
  );
  const resume = jest.fn<Promise<ToolExecutionRecord>, [string, string]>(() =>
    Promise.reject(new Error('request_not_found')),
  );
  const recentPairs = jest.fn<ExecutionPair[], [string, number]>(() => []);
  const claimTranscript = jest.fn<boolean, [string]>(() => true);
  const service = {
    consume,
    resume,
    recentPairs,
    claimTranscript,
  } as unknown as ToolExecutionService;
  return { service, consume, resume, recentPairs, claimTranscript };
}
export function stubToolLlm() {
  const chatWithTools = jest.fn<Promise<LlmResult>, [LlmToolRequest]>(() =>
    Promise.resolve(textProposal()),
  );
  const chatStreamWithTools = jest.fn<
    Promise<LlmResult>,
    [LlmToolRequest, StreamSink]
  >((_request, sink) => {
    sink.onToken('hi ');
    sink.onToken('back');
    return Promise.resolve(textProposal());
  });
  return { chatWithTools, chatStreamWithTools };
}

/** M9a agent-run double: tracking is best-effort, tests assert calls. */
export function stubAgentRuns() {
  const createRun = jest.fn(
    (input: { sessionId: string; goal: string; limits: unknown }) => ({
      id: 'run-1',
      sessionId: input.sessionId,
      goal: input.goal,
      state: 'created',
      requestIds: [],
      currentRequestId: null,
      iterationCount: 0,
      toolCallCount: 0,
      limits: input.limits,
      approvalId: null,
      clarificationId: null,
      termination: null,
      createdAt: 't',
      updatedAt: 't',
    }),
  );
  const recordStep = jest.fn(() => undefined);
  const markParked = jest.fn(() => undefined);
  const markParkedForInteraction = jest.fn(() => undefined);
  const markTerminal = jest.fn(() => undefined);
  const transitionRun = jest.fn<void, [string, string]>(() => undefined);
  const findByRequest = jest.fn<AgentRun | undefined, [string, string]>(
    () => undefined,
  );
  const get = jest.fn<AgentRun | undefined, [string]>(() => undefined);
  const cancelRun = jest.fn<AgentRun | undefined, [string]>(() => undefined);
  const service = {
    createRun,
    recordStep,
    markParked,
    markParkedForInteraction,
    markTerminal,
    transitionRun,
    findByRequest,
    get,
    cancelRun,
  } as unknown as AgentRunRepository;
  return {
    service,
    createRun,
    recordStep,
    markParked,
    markParkedForInteraction,
    markTerminal,
    transitionRun,
    findByRequest,
    get,
    cancelRun,
  };
}
