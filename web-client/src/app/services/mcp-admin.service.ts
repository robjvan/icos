import { Injectable, inject } from '@angular/core';
import { MCP_ENDPOINT } from '../../constants';
import { CoreApiService } from './core-api.service';

export interface McpServerStatus {
  name: string;
  transport: string;
  state: 'connected' | 'disabled' | 'failed';
  reason?: string;
  toolCount: number;
}

export interface McpServerEntry {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  approval?: 'required' | 'none';
}

export interface McpReloadReport {
  enabled: boolean;
  path: string;
  servers: McpServerStatus[];
  errors: string[];
}

export interface McpServerInput {
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  approval?: 'required' | 'none';
}

/** MCP management (S5). Entries carry references, never secret values. */
@Injectable({ providedIn: 'root' })
export class McpAdminService {
  private readonly api = inject(CoreApiService);

  async servers(): Promise<McpServerStatus[]> {
    const body = await this.api.get<{ servers: McpServerStatus[] }>(
      `${MCP_ENDPOINT}/servers`,
    );
    return body.servers;
  }

  async catalog(): Promise<McpServerEntry[]> {
    const body = await this.api.get<{ servers: McpServerEntry[] }>(
      `${MCP_ENDPOINT}/catalog`,
    );
    return body.servers;
  }

  async upsert(name: string, input: McpServerInput): Promise<McpReloadReport> {
    return this.api.put<McpReloadReport>(
      `${MCP_ENDPOINT}/servers/${encodeURIComponent(name)}`,
      input,
    );
  }

  async remove(name: string): Promise<McpReloadReport> {
    return this.api.delete<McpReloadReport>(
      `${MCP_ENDPOINT}/servers/${encodeURIComponent(name)}`,
    );
  }

  async reload(): Promise<McpReloadReport> {
    return this.api.post<McpReloadReport>(`${MCP_ENDPOINT}/reload`, {});
  }
}
