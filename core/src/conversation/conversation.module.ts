import { Module } from '@nestjs/common';
import { CORE_CONFIG, coreConfigProvider } from '../config';
import type { CoreConfig } from '../config';
import { ApprovalRepository } from '../approvals/approval.repository';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalsController } from '../approvals/approvals.controller';
import { PersonaModule } from '../persona/persona.module';
import { PersonaRepository } from '../persona/persona.repository';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AttachmentImageResolver } from './attachment-images';
import { ClarificationRepository } from '../clarifications/clarification.repository';
import { ClarificationService } from '../clarifications/clarification.service';
import { ClarificationsController } from '../clarifications/clarifications.controller';
import { SqliteClarificationRepository } from '../clarifications/sqlite-clarification.repository';
import { SqliteApprovalRepository } from '../approvals/sqlite-approval.repository';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import { HostHealthProvider } from '../commands/host-health';
import {
  conversationLlmClientProvider,
  memoryLlmClientProvider,
  visionLlmClientProvider,
} from '../llm/llm-client.providers';
import { LlmMemoryCandidateExtractor } from '../memory/llm-memory-candidate-extractor';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { AssociativeRecall } from '../memory/associative-recall';
import { ClaimHistoryRepository } from '../memory/claim-history.repository';
import { ClaimIndex } from '../memory/claim-index';
import { ClaimRepository } from '../memory/claim.repository';
import { KbBridge, NullKbBridge } from '../memory/kb-bridge';
import { MemoryDatabaseService } from '../memory/memory-database.service';
import { PromotionJournalRepository } from '../memory/promotion-journal.repository';
import { PromotionService } from '../memory/promotion.service';
import { ProspectiveItemRepository } from '../memory/prospective-item.repository';
import { MaintenanceService } from '../memory/maintenance.service';
import { McpClientFactory } from '../mcp/mcp-client';
import { McpConnectionService } from '../mcp/mcp-connection.service';
import { McpController } from '../mcp/mcp.controller';
import { McpToolBridge } from '../mcp/mcp-tool-bridge.service';
import { SdkMcpClientFactory } from '../mcp/sdk-mcp-client';
import { FOREIGN_TOOL_SOURCE } from '../tools/tool-registry';
import { ChannelsCoreModule } from '../channels/channels-core.module';
import { CHANNEL_SEND } from '../channels/channel-send.port';
import type { ChannelSendPort } from '../channels/channel-send.port';
import { RankService } from '../memory/rank.service';
import { SourceReliabilityRepository } from '../memory/source-reliability.repository';
import { RecallService } from '../memory/recall.service';
import { RecallTraceStore } from '../memory/recall-trace.store';
import { RuvectorClaimIndex } from '../memory/ruvector-claim-index';
import { SqliteClaimRepository } from '../memory/sqlite-claim.repository';
import { SqliteClaimHistoryRepository } from '../memory/sqlite-claim-history.repository';
import { SqliteLexicalClaimIndex } from '../memory/sqlite-lexical-claim-index';
import { SqliteProspectiveItemRepository } from '../memory/sqlite-prospective-item.repository';
import { SqliteSourceReliabilityRepository } from '../memory/sqlite-source-reliability.repository';
import { SqlitePromotionJournalRepository } from '../memory/sqlite-promotion-journal.repository';
import { SqliteMemoryCandidateRepository } from '../memory/sqlite-memory-candidate.repository';
import { ClaimConsistencyService } from '../hallucination/claim-consistency.service';
import { ClaimVerifierService } from '../hallucination/claim-verifier.service';
import { HallucinationController } from '../hallucination/hallucination.controller';
import { HallucinationGuardService } from '../hallucination/hallucination-guard.service';
import { HallucinationLedgerRepository } from '../hallucination/hallucination-ledger.repository';
import { HallucinationMitigationService } from '../hallucination/hallucination-mitigation.service';
import {
  LlmVerifier,
  VERIFICATION_CLIENT_FACTORY,
} from '../hallucination/llm-verifier.service';
import { SqliteHallucinationLedgerRepository } from '../hallucination/sqlite-hallucination-ledger.repository';
import {
  SystemoneVerifier,
  SYSTEMONE_FETCH,
} from '../hallucination/systemone-verifier.service';
import type { LlmEndpointConfig } from '../llm/llm.client';
import { SessionDatabaseService } from '../session/session-database.service';
import { SessionRepository } from '../session/session.repository';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { TodoRepository } from '../session/todo.repository';
import { SqliteTodoRepository } from '../session/sqlite-todo.repository';
import { SkillService } from '../skills/skill.service';
import { SkillSeedService } from '../skills/skill-seed.service';
import { SkillsController } from '../skills/skills.controller';
import { VisionService } from '../vision/vision.service';
import { ImageGenService } from '../image/image-gen.service';
import { ProcessRegistry } from '../process/process-registry.service';
import { CronJobRepository } from '../cron/cron-job.repository';
import { SqliteCronJobRepository } from '../cron/sqlite-cron-job.repository';
import { CronService } from '../cron/cron.service';
import { CronScheduler } from '../cron/cron-scheduler.service';
import { CronController } from '../cron/cron.controller';
import { BrowserService } from '../browser/browser.service';
import { DISCORD_ADMIN } from '../channels/discord-admin.port';
import type { DiscordAdminPort } from '../channels/discord-admin.port';
import { LlmClient } from '../llm/llm.client';
import { ToolExecutionRepository } from '../tools/tool-execution.repository';
import { ToolExecutionService } from '../tools/tool-execution.service';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolRpcTokens } from '../tools/tool-rpc.tokens';
import { ToolPrefsService } from '../tools/tool-prefs.service';
import { ToolInventoryController } from '../tools/tool-inventory.controller';
import { ToolRpcService } from '../tools/tool-rpc.service';
import { ToolRpcController } from '../tools/tool-rpc.controller';
import { CandidatesController } from './candidates.controller';
import { ClaimsController } from './claims.controller';
import { MaintenanceController } from './maintenance.controller';
import { ProspectiveController } from './prospective.controller';
import { RecallController } from './recall.controller';
import { PromotionsController } from './promotions.controller';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { AgentRunRepository } from '../agent/agent-run.repository';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ContextBudgetService } from './context-budget.service';
import { ContextCompactionService } from './context-compaction.service';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';

const toolExecutionServiceProvider = {
  provide: ToolExecutionService,
  useFactory: (
    ledger: ToolExecutionRepository,
    sessions: SessionStore,
    registry: ToolRegistry,
    llm: LlmClient,
    approvals: ApprovalRepository,
    approvalService: ApprovalService,
    mcp: McpConnectionService,
    clarifications: ClarificationService,
    channels: ChannelSendPort,
    config: CoreConfig,
    skills: SkillService,
    todos: TodoRepository,
    claims: ClaimRepository,
    recall: RecallService,
    candidates: MemoryCandidateRepository,
    persona: PersonaRepository,
    vision: VisionService,
    imageGen: ImageGenService,
    processes: ProcessRegistry,
    discordAdmin: DiscordAdminPort,
    cron: CronService,
    rpcTokens: ToolRpcTokens,
    browser: BrowserService,
    toolPrefs: ToolPrefsService,
  ): ToolExecutionService =>
    new ToolExecutionService(
      ledger,
      sessions,
      registry,
      llm,
      approvals,
      {
        workspaceRoot: config.toolsWorkspaceRoot,
        searxngBaseUrl: config.searxngBaseUrl,
        rpcBaseUrl: `http://127.0.0.1:${String(config.port)}`,
      },
      llm,
      approvalService,
      mcp,
      clarifications,
      channels,
      skills,
      todos,
      claims,
      recall,
      candidates,
      persona,
      vision,
      imageGen,
      processes,
      discordAdmin,
      cron,
      rpcTokens,
      browser,
      toolPrefs,
    ),
  inject: [
    ToolExecutionRepository,
    SessionStore,
    ToolRegistry,
    LlmClient,
    ApprovalRepository,
    ApprovalService,
    McpConnectionService,
    ClarificationService,
    CHANNEL_SEND,
    CORE_CONFIG,
    SkillService,
    TodoRepository,
    ClaimRepository,
    RecallService,
    MemoryCandidateRepository,
    PersonaRepository,
    VisionService,
    ImageGenService,
    ProcessRegistry,
    DISCORD_ADMIN,
    CronService,
    ToolRpcTokens,
    BrowserService,
    ToolPrefsService,
  ],
};

@Module({
  imports: [
    RealtimeModule,
    PersonaModule,
    ChannelsCoreModule,
    AttachmentsModule,
  ],
  controllers: [
    ConversationController,
    SessionsController,
    CandidatesController,
    ClaimsController,
    MaintenanceController,
    ProspectiveController,
    RecallController,
    PromotionsController,
    ApprovalsController,
    ClarificationsController,
    SkillsController,
    ToolRpcController,
    ToolInventoryController,
    HealthController,
    McpController,
    HallucinationController,
    CronController,
  ],
  providers: [
    coreConfigProvider,
    SessionDatabaseService,
    MemoryDatabaseService,
    {
      provide: SessionRepository,
      useClass: SqliteSessionRepository,
    },
    {
      provide: TodoRepository,
      useClass: SqliteTodoRepository,
    },
    {
      provide: MemoryCandidateRepository,
      useClass: SqliteMemoryCandidateRepository,
    },
    {
      provide: ClaimRepository,
      useClass: SqliteClaimRepository,
    },
    {
      provide: PromotionJournalRepository,
      useClass: SqlitePromotionJournalRepository,
    },
    {
      provide: ClaimHistoryRepository,
      useClass: SqliteClaimHistoryRepository,
    },
    {
      provide: ProspectiveItemRepository,
      useClass: SqliteProspectiveItemRepository,
    },
    {
      provide: SourceReliabilityRepository,
      useClass: SqliteSourceReliabilityRepository,
    },
    {
      provide: ClaimIndex,
      useClass: RuvectorClaimIndex,
    },
    SqliteLexicalClaimIndex,
    AssociativeRecall,
    {
      provide: KbBridge,
      useClass: NullKbBridge,
    },
    RecallService,
    RankService,
    RecallTraceStore,
    MaintenanceService,
    {
      provide: McpClientFactory,
      useClass: SdkMcpClientFactory,
    },
    McpConnectionService,
    McpToolBridge,
    {
      provide: FOREIGN_TOOL_SOURCE,
      useExisting: McpToolBridge,
    },
    PromotionService,
    {
      provide: MemoryCandidateExtractor,
      useClass: LlmMemoryCandidateExtractor,
    },
    {
      provide: ApprovalRepository,
      useClass: SqliteApprovalRepository,
    },
    ApprovalService,
    {
      provide: ClarificationRepository,
      useClass: SqliteClarificationRepository,
    },
    ClarificationService,
    memoryLlmClientProvider,
    conversationLlmClientProvider,
    visionLlmClientProvider,
    VisionService,
    ImageGenService,
    AttachmentImageResolver,
    ProcessRegistry,
    { provide: CronJobRepository, useClass: SqliteCronJobRepository },
    CronScheduler,
    CronService,
    ToolRpcTokens,
    ToolRpcService,
    BrowserService,
    ToolPrefsService,
    DisplayPreferenceStore,
    HostHealthProvider,
    HealthService,
    SkillService,
    SkillSeedService,
    CommandDispatcher,
    ToolRegistry,
    ToolExecutionRepository,
    toolExecutionServiceProvider,
    AgentRunRepository,
    {
      provide: HallucinationLedgerRepository,
      useClass: SqliteHallucinationLedgerRepository,
    },
    ClaimConsistencyService,
    SystemoneVerifier,
    { provide: SYSTEMONE_FETCH, useValue: fetch },
    LlmVerifier,
    {
      provide: VERIFICATION_CLIENT_FACTORY,
      useFactory: () => (endpoint: LlmEndpointConfig) =>
        new LlmClient(endpoint),
    },
    ClaimVerifierService,
    HallucinationMitigationService,
    HallucinationGuardService,
    ConversationService,
    ContextBudgetService,
    ContextCompactionService,
    SessionStore,
  ],
  exports: [ConversationService, ApprovalService, CommandDispatcher],
})
export class ConversationModule {}
