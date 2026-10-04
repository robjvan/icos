import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { parseSecretReference } from '../secrets/reference';
import { SecretResolver } from '../secrets/secret-resolver';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
} from './channel-adapter';
import type { ChannelName } from './channel.types';

/** DI token for an injected fetch (tests supply a fake). */
export const EMAIL_FETCH = 'EMAIL_FETCH';

export interface EmailFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type EmailFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<EmailFetchResponse>;

const DEFAULT_BASE_URL = 'https://api.brevo.com/v3';
const MAX_ADDRESS_LENGTH = 254;

/**
 * A pragmatic email-address check: one `@`, no whitespace or control
 * characters (so a crafted "address" cannot inject a header), and a
 * dotted domain. Not RFC 5322 — deliberately strict.
 */
export function isEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return false;
  // Reject whitespace and control characters (code <= 0x20, plus DEL) so a
  // crafted "address" cannot inject a header. Avoids a control-char regex.
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/**
 * Resolve the recipient from a conversation key: `email:<address>`.
 * Returns null when the key is not an email target or the address is
 * malformed.
 */
export function parseEmailTargetKey(conversationKey: string): string | null {
  const prefix = 'email:';
  const trimmed = conversationKey.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const address = trimmed.slice(prefix.length).trim();
  return isEmailAddress(address) ? address : null;
}

/**
 * M16.1 email adapter (outbound, Brevo transactional API). Brevo is a
 * stateless REST service, so there is no socket to hold: `connect` only
 * validates configuration and the adapter fails soft when it is absent.
 * The API key resolves through the secret resolver, exactly like the
 * Discord token, so it can be set — never viewed — from the vault.
 *
 * Inbound email is out of scope for M16.1.
 */
@Injectable()
export class EmailAdapter
  implements ChannelAdapter, OnModuleInit, OnModuleDestroy
{
  readonly name: ChannelName = 'email';
  private readonly logger = new Logger(EmailAdapter.name);
  private ready = false;
  private statusDetail = 'not started';

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly secrets: SecretResolver,
    @Optional()
    @Inject(EMAIL_FETCH)
    private readonly fetchImpl?: EmailFetch,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /** Resolve a literal key or a `$VAR` / `secret:NAME` reference. */
  private resolveApiKey(): string | null {
    const raw = this.config.brevoApiKey;
    if (!raw) return null;
    return parseSecretReference(raw) ? this.secrets.resolve(raw) : raw;
  }

  private senderEmail(): string | null {
    const sender = this.config.brevoSenderEmail?.trim();
    return sender && isEmailAddress(sender) ? sender : null;
  }

  /**
   * Brevo is stateless: "connecting" is validating configuration. Kept
   * Promise-returning to satisfy the adapter boundary without a needless
   * async (there is nothing to await yet).
   */
  connect(): Promise<void> {
    if (!this.resolveApiKey()) {
      this.ready = false;
      this.statusDetail = 'no api key configured';
    } else if (!this.senderEmail()) {
      this.ready = false;
      this.statusDetail = 'no sender configured';
    } else {
      this.ready = true;
      this.statusDetail = 'ready';
    }
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.ready = false;
    this.statusDetail = 'disconnected';
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.ready;
  }

  health(): ChannelHealth {
    return {
      channel: this.name,
      connected: this.ready,
      detail: this.statusDetail,
    };
  }

  async send(
    conversationKey: string,
    body: string,
  ): Promise<ChannelSendResult> {
    const apiKey = this.resolveApiKey();
    const sender = this.senderEmail();
    if (!this.ready || !apiKey || !sender) {
      throw new Error('email is not connected');
    }
    const to = parseEmailTargetKey(conversationKey);
    if (!to) {
      throw new Error(`unsupported email conversation key: ${conversationKey}`);
    }

    const payload = {
      sender: {
        email: sender,
        ...(this.config.brevoSenderName
          ? { name: this.config.brevoSenderName }
          : {}),
      },
      to: [{ email: to }],
      subject: this.config.emailDefaultSubject?.trim() || 'ICOS',
      textContent: body,
    };

    const fetchFn = this.fetchImpl ?? defaultFetch;
    let response: EmailFetchResponse;
    try {
      response = await fetchFn(
        `${this.config.brevoApiBaseUrl?.trim() || DEFAULT_BASE_URL}/smtp/email`,
        {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
    } catch (error) {
      // Network failure. Never echo the key; the delivery record carries
      // the target and the service owns retries/backoff.
      throw new Error(
        `email send failed: ${
          error instanceof Error ? error.message : 'network error'
        }`,
      );
    }

    if (!response.ok) {
      const detail = await readTextSnippet(response);
      this.logger.warn(`Brevo rejected an email (HTTP ${response.status})`);
      throw new Error(
        `email send failed: HTTP ${response.status}${
          detail ? ` — ${detail}` : ''
        }`,
      );
    }

    return { externalMessageId: await readMessageId(response) };
  }
}

const defaultFetch: EmailFetch = (url, init) => fetch(url, init);

/** A bounded, non-secret error snippet (never the request, never the key). */
async function readTextSnippet(response: EmailFetchResponse): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

async function readMessageId(
  response: EmailFetchResponse,
): Promise<string | null> {
  try {
    const data = (await response.json()) as { messageId?: unknown };
    return typeof data?.messageId === 'string' ? data.messageId : null;
  } catch {
    return null;
  }
}
