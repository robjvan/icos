import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('applies defaults for optional values', () => {
    const config = loadConfig({ LLM_MODEL: 'llama3.1' });
    expect(config).toMatchObject({
      port: 3000,
      host: '127.0.0.1',
      corsAllowedOrigins: ['http://localhost:4200', 'http://127.0.0.1:4200'],
      exposeAcknowledged: false,
      llmBaseUrl: 'http://localhost:11434/v1',
      llmModel: 'llama3.1',
      llmTimeoutMs: 60000,
      maxHistory: 50,
      agentMaxIterations: 5,
      agentMaxToolSteps: 5,
      agentMaxTurnDurationMs: 900000,
      realtimeEnabled: true,
      realtimeHeartbeatMs: 30000,
      realtimeAllowedOrigins: [
        'http://localhost:4200',
        'http://127.0.0.1:4200',
      ],
    });
    expect(config.llmApiKey).toBeUndefined();
    expect(config).toMatchObject({
      authEnabled: true,
      authSessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      authCookieSecure: true,
    });
    expect(config.authDirPath).toContain('.icos');
  });

  it('parses agent budget overrides and rejects non-positive values', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      AGENT_MAX_ITERATIONS: '3',
      AGENT_MAX_TOOL_STEPS: '2',
      AGENT_MAX_TURN_DURATION_MS: '60000',
    });
    expect(config).toMatchObject({
      agentMaxIterations: 3,
      agentMaxToolSteps: 2,
      agentMaxTurnDurationMs: 60000,
    });
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', AGENT_MAX_TOOL_STEPS: '0' }),
    ).toThrow(/AGENT_MAX_TOOL_STEPS/);
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      LLM_BASE_URL: 'http://x:8000/v1///',
    });
    expect(config.llmBaseUrl).toBe('http://x:8000/v1');
  });

  it('throws when LLM_MODEL is missing', () => {
    expect(() => loadConfig({})).toThrow(/LLM_MODEL is required/);
  });

  it('throws on non-positive integers', () => {
    expect(() => loadConfig({ LLM_MODEL: 'm', PORT: 'abc' })).toThrow(/PORT/);
  });

  it('defaults the split database paths under the home directory', () => {
    const config = loadConfig({ LLM_MODEL: 'm' });
    expect(config.sessionDbPath).toBe(
      join(homedir(), '.icos/data/sessions.db'),
    );
    expect(config.memoryDbPath).toBe(join(homedir(), '.icos/data/memories.db'));
    expect(config.personaDbPath).toBe(join(homedir(), '.icos/data/persona.db'));
    expect(config.personaCorePath).toBe(
      join(homedir(), '.icos/persona/core.md'),
    );
    expect(config.personaSeedRoot).toBe(join(homedir(), '.icos/seeds'));
    expect(config.legacyDbPath).toBe(
      resolve(process.cwd(), './data/core.sqlite'),
    );
  });

  it('requires the core persona by default, with a dev escape hatch', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).personaCoreRequired).toBe(true);
    expect(
      loadConfig({ LLM_MODEL: 'm', PERSONA_CORE_REQUIRED: 'false' })
        .personaCoreRequired,
    ).toBe(false);
  });

  it('resolves database path overrides absolutely', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      SESSION_DB_PATH: './custom/s.sqlite',
      MEMORY_DB_PATH: './custom/m.sqlite',
      CORE_DB_PATH: './custom/legacy.sqlite',
    });
    expect(config.sessionDbPath).toBe(
      resolve(process.cwd(), './custom/s.sqlite'),
    );
    expect(config.memoryDbPath).toBe(
      resolve(process.cwd(), './custom/m.sqlite'),
    );
    expect(config.legacyDbPath).toBe(
      resolve(process.cwd(), './custom/legacy.sqlite'),
    );
  });

  it('defaults the provider to ollama and normalizes overrides', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).provider).toBe('ollama');
    expect(
      loadConfig({ LLM_MODEL: 'm', LLM_PROVIDER: 'OpenRouter' }).provider,
    ).toBe('openrouter');
  });

  it('parses static headers and rejects malformed values', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).llmHeaders).toBeUndefined();
    expect(
      loadConfig({
        LLM_MODEL: 'm',
        LLM_HEADERS: '{"HTTP-Referer":"https://example.com"}',
      }).llmHeaders,
    ).toEqual({ 'HTTP-Referer': 'https://example.com' });
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', LLM_HEADERS: 'not-json' }),
    ).toThrow(/LLM_HEADERS/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', LLM_HEADERS: '{"a":42}' }),
    ).toThrow(/LLM_HEADERS/);
  });

  it('leaves the User-Agent unset unless configured', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).userAgent).toBeUndefined();
    expect(
      loadConfig({ LLM_MODEL: 'm', LLM_USER_AGENT: 'my-agent/2.0' }).userAgent,
    ).toBe('my-agent/2.0');
  });

  it('mirrors provider, headers, and UA into the memory role by default', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      LLM_PROVIDER: 'opencode',
      LLM_HEADERS: '{"X-Title":"t"}',
      LLM_USER_AGENT: 'my-agent/2.0',
    });
    expect(config.memoryProvider).toBe('opencode');
    expect(config.memoryLlmHeaders).toEqual({ 'X-Title': 't' });
    expect(config.memoryUserAgent).toBe('my-agent/2.0');

    const overridden = loadConfig({
      LLM_MODEL: 'm',
      LLM_PROVIDER: 'opencode',
      MEMORY_PROVIDER: 'ollama',
    });
    expect(overridden.memoryProvider).toBe('ollama');
  });

  it('defaults the skills catalog under the workspace (M18.2)', () => {
    const config = loadConfig({ LLM_MODEL: 'm' });
    expect(config.skillsDirPath).toBe(
      join(homedir(), '.icos/workspace/skills'),
    );
    expect(config.skillsSeedEnabled).toBe(true);
    expect(config.skillsEnabled).toBe(true);
    expect(config.skillsMaxBodyChars).toBe(12000);
    expect(config.skillsMaxCatalogItems).toBe(50);
    expect(config.skillsMaxActivePerSession).toBe(5);
    expect(config.skillsMaxAutoLoadedPerTurn).toBe(2);
    expect(config.skillsMaxContextChars).toBe(8000);
  });

  it('parses skills overrides and rejects non-positive budgets', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      SKILLS_DIR_PATH: './custom/skills',
      SKILLS_ENABLED: 'false',
      SKILLS_MAX_BODY_CHARS: '100',
      SKILLS_MAX_CATALOG_ITEMS: '3',
      SKILLS_MAX_ACTIVE_PER_SESSION: '1',
      SKILLS_MAX_AUTO_LOADED_PER_TURN: '1',
      SKILLS_MAX_CONTEXT_CHARS: '500',
    });
    expect(config.skillsDirPath).toBe(
      resolve(process.cwd(), './custom/skills'),
    );
    expect(config.skillsEnabled).toBe(false);
    expect(config.skillsMaxBodyChars).toBe(100);
    expect(config.skillsMaxCatalogItems).toBe(3);
    expect(config.skillsMaxActivePerSession).toBe(1);
    expect(config.skillsMaxAutoLoadedPerTurn).toBe(1);
    expect(config.skillsMaxContextChars).toBe(500);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', SKILLS_MAX_BODY_CHARS: '0' }),
    ).toThrow(/SKILLS_MAX_BODY_CHARS/);
  });

  it('defaults promotion to human approval with no auto kinds', () => {
    const config = loadConfig({ LLM_MODEL: 'm' });
    expect(config.memoryPromotionAuto).toBe(false);
    expect(config.memoryPromotionAutoKinds).toEqual([]);

    const auto = loadConfig({
      LLM_MODEL: 'm',
      MEMORY_PROMOTION_AUTO: 'true',
      MEMORY_PROMOTION_AUTO_KINDS: 'fact, observation',
    });
    expect(auto.memoryPromotionAuto).toBe(true);
    expect(auto.memoryPromotionAutoKinds).toEqual(['fact', 'observation']);

    expect(() =>
      loadConfig({ LLM_MODEL: 'm', MEMORY_PROMOTION_AUTO_KINDS: 'vibe' }),
    ).toThrow(/MEMORY_PROMOTION_AUTO_KINDS/);
  });

  it('defaults realtime on with loopback-only origins (no wildcard)', () => {
    const config = loadConfig({ LLM_MODEL: 'm' });
    expect(config.realtimeEnabled).toBe(true);
    expect(config.realtimeHeartbeatMs).toBe(30000);
    expect(config.realtimeAllowedOrigins).toEqual([
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ]);

    const off = loadConfig({ LLM_MODEL: 'm', REALTIME_ENABLED: 'false' });
    expect(off.realtimeEnabled).toBe(false);

    const scoped = loadConfig({
      LLM_MODEL: 'm',
      REALTIME_ALLOWED_ORIGINS: 'http://localhost:4200, http://host:4200',
    });
    expect(scoped.realtimeAllowedOrigins).toEqual([
      'http://localhost:4200',
      'http://host:4200',
    ]);

    // Realtime falls back to the CORS list when it has no list of its own.
    const viaCors = loadConfig({
      LLM_MODEL: 'm',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    });
    expect(viaCors.realtimeAllowedOrigins).toEqual(['https://app.example.com']);

    expect(() =>
      loadConfig({ LLM_MODEL: 'm', REALTIME_HEARTBEAT_MS: '0' }),
    ).toThrow(/REALTIME_HEARTBEAT_MS/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', REALTIME_ENABLED: 'maybe' }),
    ).toThrow(/Expected a boolean/);
  });

  it('binds loopback by default and refuses wildcard origins (S1)', () => {
    const defaults = loadConfig({ LLM_MODEL: 'm' });
    expect(defaults.host).toBe('127.0.0.1');
    expect(defaults.exposeAcknowledged).toBe(false);
    expect(defaults.corsAllowedOrigins).toEqual([
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ]);

    const exposed = loadConfig({
      LLM_MODEL: 'm',
      HOST: '0.0.0.0',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:4200',
      EXPOSE_ACKNOWLEDGED: 'true',
    });
    expect(exposed).toMatchObject({
      host: '0.0.0.0',
      exposeAcknowledged: true,
    });
    expect(exposed.corsAllowedOrigins).toEqual([
      'https://app.example.com',
      'http://localhost:4200',
    ]);

    // Wildcards are refused everywhere.
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', CORS_ALLOWED_ORIGINS: '*' }),
    ).toThrow(/not allowed/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', REALTIME_ALLOWED_ORIGINS: '*' }),
    ).toThrow(/not allowed/);

    // Origins must be bare (no path/trailing slash); bad input fails loud.
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', CORS_ALLOWED_ORIGINS: 'http://x:4200/' }),
    ).toThrow(/bare origin/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', CORS_ALLOWED_ORIGINS: 'not-a-url' }),
    ).toThrow(/not a valid origin/);
  });

  it('parses MCP switches, timeout, and reconnect backoff', () => {
    const defaults = loadConfig({ LLM_MODEL: 'm' });
    expect(defaults).toMatchObject({
      mcpEnabled: false,
      mcpServersPath: '',
      mcpTimeoutMs: 30000,
      mcpReconnectBackoffMs: 10000,
    });

    const configured = loadConfig({
      LLM_MODEL: 'm',
      MCP_ENABLED: 'true',
      MCP_SERVERS_PATH: '/etc/icos/mcp.json',
      MCP_TIMEOUT_MS: '5000',
      MCP_RECONNECT_BACKOFF_MS: '0',
    });
    expect(configured).toMatchObject({
      mcpEnabled: true,
      mcpServersPath: '/etc/icos/mcp.json',
      mcpTimeoutMs: 5000,
      // 0 is a valid opt-out (auto-retry off), not an error.
      mcpReconnectBackoffMs: 0,
    });

    expect(() =>
      loadConfig({ LLM_MODEL: 'm', MCP_RECONNECT_BACKOFF_MS: '-1' }),
    ).toThrow(/MCP_RECONNECT_BACKOFF_MS/);
    expect(() => loadConfig({ LLM_MODEL: 'm', MCP_TIMEOUT_MS: '0' })).toThrow(
      /MCP_TIMEOUT_MS/,
    );
  });

  it('parses authentication settings (S2)', () => {
    const configured = loadConfig({
      LLM_MODEL: 'm',
      AUTH_ENABLED: 'false',
      AUTH_DIR_PATH: '/etc/icos/auth',
      AUTH_SESSION_TTL_MS: '60000',
      AUTH_COOKIE_SECURE: 'false',
    });
    expect(configured).toMatchObject({
      authEnabled: false,
      authDirPath: '/etc/icos/auth',
      authSessionTtlMs: 60000,
      authCookieSecure: false,
    });

    expect(() =>
      loadConfig({ LLM_MODEL: 'm', AUTH_SESSION_TTL_MS: '0' }),
    ).toThrow(/AUTH_SESSION_TTL_MS/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', AUTH_ENABLED: 'sometimes' }),
    ).toThrow(/Expected a boolean/);
  });

  it('parses secret vault settings (S3)', () => {
    const defaults = loadConfig({ LLM_MODEL: 'm' });
    expect(defaults.vaultPath).toBe(
      join(defaults.authDirPath, 'secrets.vault'),
    );
    expect(defaults.vaultKey).toBeUndefined();
    expect(defaults.vaultKeyFile).toBeUndefined();

    const configured = loadConfig({
      LLM_MODEL: 'm',
      VAULT_PATH: '/etc/icos/v.vault',
      VAULT_KEY: 'x'.repeat(32),
    });
    expect(configured.vaultPath).toBe('/etc/icos/v.vault');
    expect(configured.vaultKey).toBe('x'.repeat(32));

    // The plan's ICOS_-prefixed names are accepted too.
    const viaFile = loadConfig({
      LLM_MODEL: 'm',
      ICOS_VAULT_KEY_FILE: '/run/secrets/vault',
    });
    expect(viaFile.vaultKeyFile).toBe('/run/secrets/vault');
  });
});
