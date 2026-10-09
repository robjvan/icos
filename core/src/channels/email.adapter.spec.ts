/* eslint-disable @typescript-eslint/require-await --
   async is required by the EmailFetch / ChannelAdapter contracts; the fake
   fetch and stubs are intentionally trivial. */
import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import {
  EmailAdapter,
  isEmailAddress,
  parseEmailTargetKey,
} from './email.adapter';
import type { EmailFetch, EmailFetchResponse } from './email.adapter';

function response(init: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): EmailFetchResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 201,
    json: async () => init.json ?? { messageId: 'msg-1' },
    text: async () => init.text ?? '',
  };
}

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    brevoApiKey: 'xkeysib-literal',
    brevoSenderEmail: 'noreply@exilelogic.ca',
    brevoSenderName: 'ICOS',
    ...overrides,
  } as unknown as CoreConfig;
}

const secrets = { resolve: () => 'resolved-key' } as unknown as SecretResolver;

describe('EmailAdapter', () => {
  it('is disabled (never blocks) without an api key', async () => {
    const adapter = new EmailAdapter(
      config({ brevoApiKey: undefined }),
      secrets,
    );
    await adapter.connect();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.health()).toMatchObject({
      channel: 'email',
      connected: false,
      detail: 'no api key configured',
    });
    await expect(adapter.send('email:a@b.com', 'hi')).rejects.toThrow(
      'not connected',
    );
  });

  it('is disabled without a valid sender', async () => {
    const adapter = new EmailAdapter(
      config({ brevoSenderEmail: 'not-an-address' }),
      secrets,
    );
    await adapter.connect();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.health()).toMatchObject({ detail: 'no sender configured' });
  });

  it('sends through Brevo and returns the message id', async () => {
    const calls: {
      url: string;
      init: { headers: Record<string, string>; body: string };
    }[] = [];
    const fetchImpl: EmailFetch = async (url, init) => {
      calls.push({ url, init });
      return response({ json: { messageId: '<abc@brevo>' } });
    };
    const adapter = new EmailAdapter(config(), secrets, fetchImpl);
    await adapter.connect();

    const result = await adapter.send('email:rob@example.com', 'hello there');

    expect(result.externalMessageId).toBe('<abc@brevo>');
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]?.init.headers['api-key']).toBe('xkeysib-literal');
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({
      sender: { email: 'noreply@exilelogic.ca', name: 'ICOS' },
      to: [{ email: 'rob@example.com' }],
      subject: 'ICOS',
      textContent: 'hello there',
    });
  });

  it('resolves a secret reference for the api key', async () => {
    const adapter = new EmailAdapter(
      config({ brevoApiKey: 'secret:BREVO_API_KEY' }),
      secrets,
      async () => response({}),
    );
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('honours a custom subject and base url', async () => {
    const calls: { url: string; body: string }[] = [];
    const adapter = new EmailAdapter(
      config({
        emailDefaultSubject: 'From ICOS',
        brevoApiBaseUrl: 'http://localhost:9999/v3',
      }),
      secrets,
      async (url, init) => {
        calls.push({ url, body: init.body });
        return response({});
      },
    );
    await adapter.connect();
    await adapter.send('email:a@b.com', 'x');

    expect(calls[0]?.url).toBe('http://localhost:9999/v3/smtp/email');
    const payload = JSON.parse(calls[0]?.body ?? '{}') as { subject?: string };
    expect(payload.subject).toBe('From ICOS');
  });

  it('rejects a non-email conversation key', async () => {
    const adapter = new EmailAdapter(config(), secrets, async () =>
      response({}),
    );
    await adapter.connect();
    await expect(adapter.send('discord:g:c', 'x')).rejects.toThrow(
      'unsupported email conversation key',
    );
    await expect(adapter.send('email:not-an-address', 'x')).rejects.toThrow(
      'unsupported email conversation key',
    );
  });

  it('throws a bounded error on a non-2xx response', async () => {
    const adapter = new EmailAdapter(config(), secrets, async () =>
      response({ ok: false, status: 400, text: 'invalid  sender   blah' }),
    );
    await adapter.connect();
    await expect(adapter.send('email:a@b.com', 'x')).rejects.toThrow(
      'HTTP 400 — invalid sender blah',
    );
  });

  it('fails soft on a network error', async () => {
    const adapter = new EmailAdapter(config(), secrets, async () => {
      throw new Error('socket hang up');
    });
    await adapter.connect();
    await expect(adapter.send('email:a@b.com', 'x')).rejects.toThrow(
      'email send failed: socket hang up',
    );
  });
});

describe('email target parsing', () => {
  it('accepts normal addresses and rejects injection or malformed ones', () => {
    expect(isEmailAddress('rob@example.com')).toBe(true);
    expect(isEmailAddress('a.b+c@sub.example.co.uk')).toBe(true);
    expect(isEmailAddress('no-at-sign')).toBe(false);
    expect(isEmailAddress('a@b')).toBe(false);
    expect(isEmailAddress('two@@at.com')).toBe(false);
    expect(isEmailAddress('a@b.com\r\nBcc: evil@x.com')).toBe(false);
  });

  it('parses email targets only', () => {
    expect(parseEmailTargetKey('email:rob@example.com')).toBe(
      'rob@example.com',
    );
    expect(parseEmailTargetKey('  email:rob@example.com  ')).toBe(
      'rob@example.com',
    );
    expect(parseEmailTargetKey('discord:g:c')).toBeNull();
    expect(parseEmailTargetKey('email:bad')).toBeNull();
  });
});
