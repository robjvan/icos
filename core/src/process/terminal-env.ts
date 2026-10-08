/**
 * Minimal environment for a spawned shell command: a command must never be
 * able to read the core's secrets (API keys, tokens, the vault key) from the
 * process environment. Shared by the `terminal` tool and the process registry.
 */
export function terminalEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'TERM',
    'TMPDIR',
    'USER',
    'SHELL',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
