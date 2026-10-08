import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { terminalEnv } from './terminal-env';

const MAX_PROCESSES = 8;
const MAX_OUTPUT_BYTES = 48 * 1024;

export type ProcessStatus = 'running' | 'exited';

export interface ProcessInfo {
  id: string;
  pid: number | null;
  command: string;
  cwd: string;
  status: ProcessStatus;
  exitCode: number | null;
  startedAt: string;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

interface TrackedProcess extends ProcessInfo {
  child: ChildProcess | null;
  bytes: number;
}

/**
 * M17c.2 background-process registry. In-memory and per core process: a
 * restart loses tracking (and orphans any running children), so this is a
 * working-memory tool, not a durable job system. Only processes started
 * through it are addressable; `process_manage` never touches arbitrary pids.
 */
@Injectable()
export class ProcessRegistry {
  private readonly processes = new Map<string, TrackedProcess>();

  start(input: { command: string; cwd: string }): ProcessInfo {
    const running = [...this.processes.values()].filter(
      (tracked) => tracked.status === 'running',
    ).length;
    if (running >= MAX_PROCESSES) throw new Error('process_limit');
    const id = randomUUID();
    const child = spawn('/bin/sh', ['-c', input.command], {
      cwd: input.cwd,
      env: terminalEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const tracked: TrackedProcess = {
      id,
      pid: child.pid ?? null,
      command: input.command,
      cwd: input.cwd,
      status: 'running',
      exitCode: null,
      startedAt: new Date().toISOString(),
      truncated: false,
      stdout: '',
      stderr: '',
      child,
      bytes: 0,
    };
    child.stdout?.on('data', (chunk: Buffer) =>
      this.append(tracked, chunk, 'stdout'),
    );
    child.stderr?.on('data', (chunk: Buffer) =>
      this.append(tracked, chunk, 'stderr'),
    );
    const settle = (code: number | null): void => {
      tracked.status = 'exited';
      tracked.exitCode = code;
      tracked.child = null;
    };
    child.on('error', () => settle(null));
    child.on('close', (code) => settle(code));
    this.processes.set(id, tracked);
    return toInfo(tracked);
  }

  list(): ProcessInfo[] {
    return [...this.processes.values()].map(toInfo);
  }

  output(id: string): ProcessInfo | null {
    const tracked = this.processes.get(id);
    return tracked ? toInfo(tracked) : null;
  }

  /** Kill a tracked, still-running process (and its whole group). */
  kill(id: string): boolean {
    const tracked = this.processes.get(id);
    if (!tracked || tracked.status !== 'running') return false;
    if (tracked.pid) {
      try {
        globalThis.process.kill(-tracked.pid, 'SIGKILL');
      } catch {
        tracked.child?.kill('SIGKILL');
      }
    }
    return true;
  }

  private append(
    tracked: TrackedProcess,
    chunk: Buffer,
    which: 'stdout' | 'stderr',
  ): void {
    if (tracked.bytes >= MAX_OUTPUT_BYTES) {
      tracked.truncated = true;
      return;
    }
    let text = chunk.toString('utf8');
    const remaining = MAX_OUTPUT_BYTES - tracked.bytes;
    if (Buffer.byteLength(text) > remaining) {
      text = text.slice(0, remaining);
      tracked.truncated = true;
    }
    tracked.bytes += Buffer.byteLength(text);
    if (which === 'stdout') tracked.stdout += text;
    else tracked.stderr += text;
  }
}

function toInfo(tracked: TrackedProcess): ProcessInfo {
  return {
    id: tracked.id,
    pid: tracked.pid,
    command: tracked.command,
    cwd: tracked.cwd,
    status: tracked.status,
    exitCode: tracked.exitCode,
    startedAt: tracked.startedAt,
    truncated: tracked.truncated,
    stdout: tracked.stdout,
    stderr: tracked.stderr,
  };
}
