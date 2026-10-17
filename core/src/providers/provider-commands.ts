import { BadRequestException } from '@nestjs/common';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from '../commands/command-result';
import type { ProviderRegistryService } from './provider-registry.service';
import type { ProviderRole } from './provider-catalog';

export interface ProviderCommandDeps {
  registry: ProviderRegistryService;
}

/** The effective model for a role (override, else the entry's default). */
function effectiveModel(
  registry: ProviderRegistryService,
  role: ProviderRole,
): string {
  const override = registry.activeModelFor(role);
  if (override) return override;
  const id = registry.report().active[role];
  const entry = registry
    .catalogEntries()
    .find((candidate) => candidate.id === id);
  return entry?.model ?? '(env)';
}

/**
 * `/model` (FG9c S4): show or switch the active conversation provider and
 * model. Deterministic — no LLM contact. The selection takes effect on the
 * next turn (the registry resolves endpoints on demand).
 */
class ModelCommand implements SlashCommandHandler {
  readonly name = 'model';
  readonly description =
    'Show or switch the active conversation provider and model. No LLM contact.';
  constructor(private readonly deps: ProviderCommandDeps) {}

  async execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    void context;
    const [first, second] = args;
    if (!first) return this.status();
    const lower = first.toLowerCase();
    if (lower === 'status') return this.status();
    if (lower === 'list') return this.list(second);
    // Two args: <provider> <model>. One arg: a known provider id switches the
    // provider, anything else is a model on the active provider. (Model ids
    // often contain "/", so a "<provider>/<model>" form would be ambiguous.)
    if (second !== undefined) return this.setProviderModel(first, second);
    if (this.isProvider(first)) return this.setProvider(first);
    return this.setModel(first);
  }

  private status(): CommandResult {
    const report = this.deps.registry.report();
    const conversation = {
      provider: report.active.conversation,
      model: effectiveModel(this.deps.registry, 'conversation'),
    };
    const memory = {
      provider: report.active.memory,
      model: effectiveModel(this.deps.registry, 'memory'),
    };
    const providers = report.providers.map((provider) => provider.id);
    return {
      kind: 'data',
      text: [
        `Conversation: ${conversation.provider} · ${conversation.model}`,
        `Memory: ${memory.provider} · ${memory.model}`,
        `Providers (${report.source}): ${providers.join(', ') || 'none — LLM_* env values in use'}`,
        'Switch: /model <model> · /model <provider> <model> · /model list [provider]',
      ].join('\n'),
      data: { conversation, memory, source: report.source, providers },
    };
  }

  private async list(providerId?: string): Promise<CommandResult> {
    const report = this.deps.registry.report();
    if (!providerId) {
      if (report.providers.length === 0) {
        return {
          kind: 'message',
          text: 'No catalog providers; the LLM_* environment values are in use. Add one in the Models tab.',
          data: { providers: [] },
        };
      }
      return {
        kind: 'data',
        text: [
          'Configured providers:',
          ...report.providers.map((provider) => {
            const badges = [
              provider.id === report.active.conversation ? 'conversation' : '',
              provider.id === report.active.memory ? 'memory' : '',
            ].filter((badge) => badge !== '');
            const window =
              provider.contextWindow !== undefined
                ? ` (${String(provider.contextWindow)} tokens)`
                : '';
            return `- ${provider.id} · ${provider.model}${window}${badges.length > 0 ? ` [${badges.join(', ')}]` : ''}`;
          }),
          "List a provider's models: /model list <provider>",
        ].join('\n'),
        data: { providers: report.providers.map((provider) => provider.id) },
      };
    }
    const result = await this.deps.registry.listModels(providerId);
    if (!result.ok) {
      return {
        kind: 'message',
        text: `Could not list models for "${providerId}": ${result.detail}.`,
        data: { provider: providerId, ok: false, detail: result.detail },
      };
    }
    return {
      kind: 'data',
      text: [
        `Models for ${providerId} (${String(result.models.length)}):`,
        ...result.models.map(
          (model) =>
            `- ${model.id}${model.contextWindow !== undefined ? ` (${String(model.contextWindow)} tokens)` : ''}`,
        ),
        `Switch: /model ${providerId} <model>`,
      ].join('\n'),
      data: {
        provider: providerId,
        ok: true,
        models: result.models.map((model) => model.id),
      },
    };
  }

  private isProvider(id: string): boolean {
    return this.deps.registry.catalogEntries().some((entry) => entry.id === id);
  }

  private setProviderModel(provider: string, model: string): CommandResult {
    this.apply(provider, model);
    return {
      kind: 'message',
      text: `Conversation model → ${provider} · ${model}. Takes effect on the next turn.`,
      data: { role: 'conversation', provider, model },
    };
  }

  private setProvider(provider: string): CommandResult {
    this.apply(provider, undefined);
    return {
      kind: 'message',
      text: `Conversation provider → ${provider} (its default model). Takes effect on the next turn.`,
      data: { role: 'conversation', provider, model: null },
    };
  }

  private setModel(model: string): CommandResult {
    const active = this.deps.registry.report().active.conversation;
    if (!this.isProvider(active)) {
      throw new BadRequestException(
        `The active conversation provider "${active}" is not in the catalog. Use /model <provider> <model> (add providers in the Models tab).`,
      );
    }
    this.apply(active, model);
    return {
      kind: 'message',
      text: `Conversation model → ${active} · ${model}. Takes effect on the next turn.`,
      data: { role: 'conversation', provider: active, model },
    };
  }

  private apply(provider: string, model?: string): void {
    try {
      this.deps.registry.setActive('conversation', provider, model);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'could not set the active model',
      );
    }
  }
}

export function registerProviderCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: ProviderCommandDeps,
): void {
  register(new ModelCommand(deps));
}
