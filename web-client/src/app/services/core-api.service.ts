import { Injectable } from '@angular/core';
import {
  APPROVALS_ENDPOINT,
  CLARIFICATIONS_ENDPOINT,
  CONVERSATION_ENDPOINT,
  SERVER_URL,
  SESSIONS_ENDPOINT,
} from '../../constants';
import { CSRF_HEADER, csrfToken, mutationHeaders } from '../auth/credentials';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    // A 401 means the session expired: let the app redirect to login.
    // The login call itself is exempt (a wrong token is a normal 401).
    if (
      response.status === 401 &&
      !what.includes('/core/auth/login') &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event('icos:unauthorized'));
    }
    let detail = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string };
      detail = data.message ?? detail;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new Error(`${what} failed: ${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * Thin `fetch` wrapper over the core REST API (non-streaming calls).
 * Streaming turns live in `ConversationStreamService` (fetch + ReadableStream).
 */
@Injectable({ providedIn: 'root' })
export class CoreApiService {
  async get<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(joinUrl(SERVER_URL, endpoint));
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url.toString(), { credentials: 'include' });
    return readJson<T>(response, `GET ${endpoint}`);
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(joinUrl(SERVER_URL, endpoint), {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return readJson<T>(response, `POST ${endpoint}`);
  }

  /** POST a multipart form (the browser sets the content type + boundary). */
  async postForm<T>(endpoint: string, form: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    const token = csrfToken();
    if (token) headers[CSRF_HEADER] = token;
    const response = await fetch(joinUrl(SERVER_URL, endpoint), {
      method: 'POST',
      headers,
      body: form,
      credentials: 'include',
    });
    return readJson<T>(response, `POST ${endpoint}`);
  }

  async put<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(joinUrl(SERVER_URL, endpoint), {
      method: 'PUT',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return readJson<T>(response, `PUT ${endpoint}`);
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(joinUrl(SERVER_URL, endpoint), {
      method: 'DELETE',
      headers: mutationHeaders(),
      credentials: 'include',
    });
    return readJson<T>(response, `DELETE ${endpoint}`);
  }

  conversationUrl(suffix: '' | '/stream' | '/resume' | '/resume-stream'): string {
    return joinUrl(SERVER_URL, `${CONVERSATION_ENDPOINT}${suffix}`);
  }

  sessionsUrl(): string {
    return joinUrl(SERVER_URL, SESSIONS_ENDPOINT);
  }

  approvalsUrl(): string {
    return joinUrl(SERVER_URL, APPROVALS_ENDPOINT);
  }

  clarificationsUrl(): string {
    return joinUrl(SERVER_URL, CLARIFICATIONS_ENDPOINT);
  }
}
