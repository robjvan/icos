import { Injectable, inject } from '@angular/core';
import { mutationHeaders } from '../auth/credentials';
import type { TurnAttachment } from '../models/attachment';
import { parseStreamBlock, splitStreamBlocks } from '../models/stream-event';
import type { StreamEvent } from '../models/stream-event';
import { CoreApiService } from './core-api.service';

export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
}

/**
 * Browser SSE client for `POST /core/conversation/stream` and
 * `POST /core/conversation/resume-stream`. Uses `fetch` + `ReadableStream`
 * (not `EventSource`) because the endpoints require POST bodies.
 * Framing mirrors `test-client.html` `readStream` exactly.
 */
@Injectable({ providedIn: 'root' })
export class ConversationStreamService {
  private readonly api = inject(CoreApiService);

  async streamTurn(
    message: string,
    sessionId: string | null,
    attachments: readonly TurnAttachment[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const body: Record<string, unknown> = { message };
    if (sessionId) body['sessionId'] = sessionId;
    if (attachments.length > 0) body['attachments'] = attachments;
    await this.postStream(
      this.api.conversationUrl('/stream'),
      body,
      callbacks,
      signal,
    );
  }

  async resumeTurn(
    requestId: string,
    sessionId: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.postStream(
      this.api.conversationUrl('/resume-stream'),
      { requestId, sessionId },
      callbacks,
      signal,
    );
  }

  private async postStream(
    url: string,
    body: unknown,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(body),
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (!response.ok || !response.body) {
      let detail = `HTTP ${response.status}`;
      try {
        const data = (await response.json()) as { message?: string };
        detail = data.message ?? detail;
      } catch {
        // Non-JSON error body; keep the status text.
      }
      callbacks.onError(new Error(detail));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const { blocks, rest } = splitStreamBlocks(buffer);
        buffer = rest;
        for (const block of blocks) {
          const event = parseStreamBlock(block);
          if (event) {
            callbacks.onEvent(event);
          }
        }
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      reader.releaseLock();
    }
  }
}
