# Full Roadmap

> _Note: There is a really important conceptual jump around M22–M26._

**M1–M9: Can we make an agent?**

- Runtime, memory primitives, tools, execution, orchestration.

**M10–M15.5: Can we make an agent that knows things reliably?**

- Epistemic memory, retrieval, revision, provenance, identity, drift, verification.

**M16–M21: Can we put that agent into an environment?**

- Communication, actions, sensors, events, subagents, KB stewardship.

**M22–M26: Can the agent observe and improve its own operation?**

- That's where things get genuinely research-y.

- Not _"give the LLM permission to modify itself"_, rather:

  ```text
  observe → measure → hypothesize → experiment → evaluate → propose change → verify → deploy/rollback.
  ```

**M27 onward starts asking the really interesting questions:**

- _Does cognition have to belong to one model?_
- _Does an agent have to live on one machine?_
- _Can an agent maintain goals over very long periods?_
- _What happens when the environment is physical rather than textual?_
- _Can experience become knowledge?_
- _Can knowledge gaps generate research?_
- _What exactly constitutes continuity when the model, hardware, software, and even instance change?_

**_M37 onward gets weird..._**

---

## Build Milestones

- [x] ~~**M1: Build core**~~
  - [x] ~~Minimum conversation loop~~
  - [x] ~~No memory, skills, tools, etc.~~
  - [x] ~~Generic OpenAI-compatible LLM client (Ollama/vLLM) with 502/504 mapping~~
  - [x] ~~In-memory sessions, context builder, REST conversation endpoints~~
  - [x] ~~Minimum slice chat client served same-origin at `/`~~

- [x] ~~**M2: Streaming**~~
  - [x] ~~`LlmClient.chatStream` parses upstream SSE with 502/504 mapping and abort support~~
  - [x] ~~Test client renders tokens live; history stored on clean completion only~~
  - [x] ~~`POST /core/conversation/stream` emits meta/token/done/error events~~

- [x] ~~**M3: Persistent Session Store + FTS5**~~
  - [x] ~~Session persistence in SQLite store~~
  - [x] ~~Session sidebar in chat UI~~
  - [x] ~~SQLite transcript store (sessions/messages) with FTS5 index, triggers, rebuild~~
  - [x] ~~Async `SessionStore` over a repository boundary; `MAX_HISTORY` is context-only~~
  - [x] ~~`GET /core/sessions` and `GET /core/sessions/search` (phrase fallback for raw FTS errors)~~

- [x] ~~**M4: Memory Candidate Extraction**~~
  - [x] ~~LLM extractor with deterministic validation and message-level provenance~~
  - [x] ~~`memory_candidates` ledger in SQLite~~
  - [x] ~~Fire-and-forget enrichment that never blocks or fails conversation~~
  - [x] ~~Separate `MEMORY_LLM_*` model role behind the generic `LlmClient` boundary~~
  - [x] ~~`GET /core/memory-candidates` inspection endpoint~~

- [x] ~~**M5: External Providers**~~
  - [x] ~~Request contract carries conversation `sessionId` explicitly to `LlmClient`~~
  - [x] ~~Composable headers: `base + Bearer + static extras + UA + opencode-family` session affinity~~
  - [x] ~~Provider/model/headers/UA config with full `MEMORY_*` mirror, all env-driven~~
  - [x] ~~Provider-tagged errors, secrets-audited; zero provider branches in Core layers~~

- [x] ~~**M6: Interaction Protocol**~~
  - [x] ~~Deterministic slash commands (`/status /new /health /export /rename /thinking /timestamps /undo /fork /restart-runtime`)~~
  - [x] ~~Parser + registry/dispatch; commands bypass the LLM with structured `CommandResult`~~
  - [x] ~~Commands write no transcript rows and trigger no memory extraction~~
  - [x] ~~Structured approvals with explicit IDs and lifecycle (`pending → approved/rejected/expired/cancelled`)~~
  - [x] ~~UI approve/reject; LLM text can never approve; invalid transitions rejected~~
  - [x] ~~Clarifications/questions — free-form + structured choices, answer/cancel, resume semantics~~
  - [x] ~~Approval/clarification events isolated from the session transcript~~

- [x] ~~**M7: Skills — Discovery, Retrieval, Activation, Context Injection**~~
  - [x] ~~Filesystem catalog (`SKILL.md`, fail-closed validation, `~/.icos/skills/`)~~
  - [x] ~~Deterministic discovery + `/skills suggest` (no embeddings)~~
  - [x] ~~Three scopes — session-pinned, one-shot, turn-contextual — delimited injection, observability~~
  - [x] ~~Evidence: `milestone-7a/7b/7c-evidence-skills.md`; live Isabel discovers `icos-v3-stack`~~

- [x] ~~**M8: Tool Integration**~~
  - [x] ~~Tool contracts~~
  - [x] ~~Model tool-call protocol~~
  - [x] ~~Bounded execution~~
  - [x] ~~Approval and persistence~~
  - [x] ~~Invocation ledger~~
  - [x] ~~Durable call / result pairing~~
  - [x] ~~Idempotency and duplicate-call handling~~
  - [x] ~~Failure and unknown-outcome handling~~
  - [x] ~~Verification~~

- [x] ~~**M9: Agent Orchestration**~~
  - [x] ~~Agent run state~~
  - [x] ~~Tool selection and planning~~
  - [x] ~~Observation → action loop~~
  - [x] ~~Termination criteria~~
  - [x] ~~Execution budgets~~
  - [x] ~~Failure and recovery~~
  - [x] ~~Approval-aware planning~~
  - [x] ~~Loop / repetition protection~~
  - [x] ~~Cancellation and restart semantics~~
  - [x] ~~End-to-end verification~~

- [x] ~~**M10: Build the Epistemic Memory**~~
  - [x] ~~Epistemic claim model~~
  - [x] ~~Evidence → claim processing~~
  - [x] ~~Claim identity / deduplication~~
  - [x] ~~Provenance and evidence tracing~~
  - [x] ~~Contradiction / reinforcement~~
  - [x] ~~Epistemic storage model~~
  - [x] ~~RuVector substrate~~
  - [x] ~~Epistemic memory verification~~

- [x] ~~**M11: Memory Retrieval / Application**~~
  - [x] ~~Contextual recall~~
  - [x] ~~Memory ranking~~
  - [x] ~~Cross-memory comparison~~
  - [x] ~~Memory-aware context construction~~
  - [x] ~~Retrieval budgeting~~
  - [x] ~~Retrieval failure / uncertainty handling~~
  - [x] ~~Retrieval evaluation~~

- [x] ~~**M12: Memory Dynamics**~~
  - [x] ~~Consolidation~~
  - [x] ~~Supersession~~
  - [x] ~~Decay / forgetting~~
  - [x] ~~Temporal reasoning~~
  - [x] ~~Belief revision~~
  - [x] ~~Source reliability~~
  - [x] ~~Memory dynamics evaluation~~

- [x] ~~**M13: MCP Server Support**~~
  - [x] ~~MCP server boundary~~
  - [x] ~~Tool exposure~~
  - [x] ~~Resource / context exposure~~
  - [x] ~~MCP identity / permissions~~
  - [x] ~~Approval / execution integration~~
  - [x] ~~MCP verification~~

- [x] ~~**M14: Persistent Persona Maintenance**~~
  - [x] ~~Immutable core persona (file-backed, read-only, integrity-pinned, no write path)~~
  - [x] ~~Evolving persona model (identity / user / relationship)~~
  - [x] ~~Persona provenance~~
  - [x] ~~Persona seed import and update / maintenance~~
  - [x] ~~Grounding check and session-start context band~~
  - [x] ~~Candidate staging (memory proposes, persona adjudicates)~~
  - [x] ~~Reviewed curation (protected records, corrigibility)~~
  - [x] ~~Isolation invariant (identity sealed from memory, core sealed from the system)~~
  - [x] ~~Model-independent persona persistence~~
  - [x] ~~Persona recovery~~
  - [x] ~~Persona review UI~~
  - [x] ~~Persona verification~~

- [x] ~~**M15: Drift Detection and Reporting**~~
  - [x] ~~Define observable drift failure modes~~
  - [x] ~~Establish behavioral / epistemic baselines~~
  - [x] ~~Structural drift (core / protected contradiction, staleness, repeated pressure, low grounding)~~
  - [x] ~~Distributional drift detection~~
    - [x] ~~Evaluate Wasserstein distance and simpler alternatives~~
  - [x] ~~Cumulative drift across review cycles~~
  - [x] ~~Finding reconciliation / de-duplication~~
  - [x] ~~Drift reporting surface~~
  - [x] ~~Evaluation~~
  > _Detection + reconciliation + honest calibration delivered. Semantic
  > drift is a measured **advisory** signal (embedding F1 0.78 on the M15e
  > corpus); subtle propositional drift is deferred to M15.5. Further
  > tuning: `.reference/plans/drift-tuning-backlog.md`._

- [ ] **M15.5: Hallucination Mitigation**
  - [ ] Define observable hallucination failure modes
  - [ ] Claim / evidence consistency checking
  - [ ] Secondary-model verification (provider-agnostic)
  - [ ] Mitigation strategies (flag / re-ground / defer / refuse)
  - [ ] False-positive / false-negative analysis
  - [ ] Evaluation

- [ ] **M16: External Communication Integrations**
  - [ ] Discord integration
  - [ ] Email integration
  - [ ] SMS integration
  - [ ] Unified inbound / outbound message model
  - [ ] Identity and conversation mapping across channels
  - [ ] Channel-specific permissions and capabilities
  - [ ] Attachment / media handling
  - [ ] Rate limits, retries, and delivery state
  - [ ] Cross-channel context continuity
  - [ ] Integration verification

- [ ] **M17: Autonomous Agency and Action Execution**
  - [ ] Action registry
  - [ ] Action capability discovery
  - [ ] Action permissions and trust levels
  - [ ] Human approval policies
  - [ ] Goal → plan → action execution
  - [ ] Long-running agent runs
  - [ ] Action scheduling / deferred execution?
  - [ ] Action preconditions and postconditions
  - [ ] Action outcome verification
  - [ ] Failure, retry, and unknown-outcome handling
  - [ ] Action history and auditability
  - [ ] Agency boundaries and kill-switches

- [ ] **M18: External Sensory Reintegration**
  - [ ] Sensor abstraction layer
  - [ ] Microphone / audio input
  - [ ] Brio / camera input
  - [ ] Sensor box / environmental telemetry
  - [ ] Event-driven sensory observations
  - [ ] Multimodal observation representation
  - [ ] Sensor provenance and timestamps
  - [ ] Perception → memory integration
  - [ ] Perception → reactionary event integration
  - [ ] Continuous vs sampled observation?
  - [ ] Local preprocessing vs model inference?
  - [ ] Sensory verification and failure handling

- [ ] **M19: Subagent Support**
  - [ ] Subagent lifecycle
  - [ ] Task delegation protocol
  - [ ] Subagent capability / tool boundaries
  - [ ] Parent → child context transfer
  - [ ] Child → parent result / evidence transfer
  - [ ] Shared vs isolated memory
  - [ ] Subagent permissions and trust levels
  - [ ] Resource / token / time budgets
  - [ ] Nested delegation?
  - [ ] Parallel subagents?
  - [ ] Subagent failure / cancellation / timeout
  - [ ] Result verification and provenance

- [ ] **M20: Reactionary Events**
  - [ ] Event ingestion and normalization
  - [ ] Event registry / subscriptions
  - [ ] Event → agent run triggering
  - [ ] Event filtering and relevance evaluation
  - [ ] Event priority / urgency
  - [ ] Event deduplication and suppression
  - [ ] Reaction policies and permissions
  - [ ] Autonomous response without conversational initiation
  - [ ] Event-triggered tool / action execution
  - [ ] Event-triggered memory updates
  - [ ] Reaction cooldowns / loop prevention
  - [ ] Event provenance and audit history
  - [ ] Persistent event processing across restart
  - [ ] Continuous event streams vs discrete events?

- [ ] **M21: Knowledge-Base Stewardship**
  - [ ] Knowledge-base topology model
  - [ ] File / folder metadata extraction
  - [ ] Topological metadata maintenance
  - [ ] `INDEX.md` generation and maintenance
  - [ ] Project status generation / maintenance
  - [ ] "Last updated" / activity-based project state
  - [ ] Inbox ingestion
  - [ ] File classification and destination selection
  - [ ] Safe file moves / renames
  - [ ] Stale-file detection
  - [ ] Archive / `_prune` lifecycle
  - [ ] Duplicate / near-duplicate detection
  - [ ] Broken-link / reference detection
  - [ ] Orphaned-file detection
  - [ ] Metadata / index consistency verification
  - [ ] Stewardship change journal / audit trail
  - [ ] Human approval thresholds for destructive operations
  - [ ] Dry-run / proposed-change mode
  - [ ] Periodic autonomous stewardship runs
  - [ ] Small-model stewardship harness
  - [ ] Model-independent deterministic safeguards
  - [ ] Automatic topology reconstruction?
  - [ ] Knowledge-health scoring?
  - [ ] Cross-project knowledge relationships?

- [ ] **M22: Self-Observation and Introspection**
  - [ ] Runtime health observation
  - [ ] Agent behavior telemetry
  - [ ] Tool / action performance monitoring
  - [ ] Resource awareness
  - [ ] Execution tracing
  - [ ] Self-generated diagnostics
  - [ ] Behavioral anomaly detection
  - [ ] Internal state inspection
  - [ ] Reliable introspection boundaries?

- [ ] **M23: Self-Evaluation and Capability Assessment**
  - [ ] Capability registry
  - [ ] Capability → evidence mapping
  - [ ] Automated capability tests
  - [ ] Regression detection
  - [ ] Tool reliability measurement
  - [ ] Memory retrieval evaluation
  - [ ] Agent-loop evaluation
  - [ ] Confidence / uncertainty calibration
  - [ ] Self-generated test cases?
  - [ ] Capability-gap detection
  - [ ] Observed capability vs assumed capability

- [ ] **M24: Self-Maintenance**
  - [ ] Configuration integrity
  - [ ] Dependency / service health
  - [ ] Database maintenance
  - [ ] Index maintenance
  - [ ] Cache / artifact lifecycle
  - [ ] Failed-job recovery
  - [ ] Resource reclamation
  - [ ] Stale-process detection
  - [ ] Automated maintenance tasks
  - [ ] Maintenance approval policies
  - [ ] Repair vs modification boundaries
  - [ ] Deterministic maintenance safeguards

- [ ] **M25: Autopoiesis**
  - [ ] Self-inspection of the running codebase
  - [ ] Source / configuration / dependency inventory
  - [ ] Architecture and capability introspection
  - [ ] Detect bugs, deficiencies, inefficiencies, and capability gaps
  - [ ] Generate upgrade / optimization / feature proposals
  - [ ] Proposal → implementation plan
  - [ ] Stage proposed changes in an isolated environment
  - [ ] Automated build and test pipeline
  - [ ] Regression / behavioral verification
  - [ ] Evidence-backed change proposals
  - [ ] Human approval gate
  - [ ] Production candidate generation
  - [ ] Production candidate boot / health verification
  - [ ] Shadow / parallel execution?
  - [ ] Blue/green or generation-based deployment
  - [ ] Atomic instance promotion
  - [ ] State migration
  - [ ] Graceful instance handoff
  - [ ] Old-generation preservation
  - [ ] Automatic rollback
  - [ ] Failed-generation quarantine
  - [ ] Live-backup reconstruction
  - [ ] Versioned self-modification history
  - [ ] Complete provenance: observation → proposal → change → test → approval → deployment
  - [ ] Self-modification safety invariants
  - [ ] Operational continuity across self-generated transformations

- [ ] **M26: Experimental Learning**
  - [ ] Hypothesis representation
  - [ ] Experiment planning
  - [ ] Controlled experiment execution
  - [ ] Observation collection
  - [ ] Evidence evaluation
  - [ ] Hypothesis confirmation / rejection
  - [ ] Experimental provenance
  - [ ] Automated benchmark generation?
  - [ ] Autonomous experiment proposal?
  - [ ] Experiment → knowledge → capability improvement

- [ ] **M27: Multi-Model Cognition**
  - [ ] Model capability registry
  - [ ] Task → model selection
  - [ ] Specialist model roles
  - [ ] Cross-model verification
  - [ ] Model disagreement handling
  - [ ] Dynamic model routing
  - [ ] Local vs remote model selection
  - [ ] Model replacement without state loss
  - [ ] Cognitive ensemble vs single-primary architecture?

- [ ] **M28: Distributed ICOS**
  - [ ] Remote / redundant instances
  - [ ] Shared epistemic state
  - [ ] Instance identity
  - [ ] State synchronization
  - [ ] Distributed task delegation
  - [ ] Instance health / availability
  - [ ] Local autonomy during disconnection
  - [ ] Generation-aware state replication
  - [ ] Failover between instances
  - [ ] Federation vs centralized coordination?

- [ ] **M29: Long-Horizon Agency**
  - [ ] Persistent goals
  - [ ] Goal decomposition
  - [ ] Goal prioritization
  - [ ] Long-running plans
  - [ ] Progress tracking
  - [ ] Temporal reasoning
  - [ ] Interrupted-plan recovery
  - [ ] Goal abandonment / revision
  - [ ] Competing-goal resolution
  - [ ] Long-horizon memory integration

- [ ] **M30: Embodied Autonomy**
  - [ ] Physical action registry
  - [ ] Robot / actuator interfaces
  - [ ] Spatial state representation
  - [ ] Environmental perception
  - [ ] Navigation
  - [ ] Manipulation
  - [ ] Physical-world verification
  - [ ] Safety envelopes
  - [ ] Physical-world recovery
  - [ ] Simulated embodiment before physical deployment?

- [ ] **M31: Situated Learning**
  - [ ] Persistent environment models
  - [ ] Spatial memory
  - [ ] Sensor → event → memory pipeline
  - [ ] Action → observation feedback
  - [ ] Environmental state estimation
  - [ ] Experience-based adaptation
  - [ ] Physical affordance learning?
  - [ ] Environment-specific knowledge formation

- [ ] **M32: Open-Ended Knowledge Acquisition**
  - [ ] Source discovery
  - [ ] Source evaluation
  - [ ] Automated research tasks
  - [ ] Evidence collection
  - [ ] Claim extraction
  - [ ] Cross-source comparison
  - [ ] Contradiction discovery
  - [ ] Knowledge-gap detection
  - [ ] Research prioritization
  - [ ] Autonomous research campaigns?
  - [ ] Explicit epistemic limits

- [ ] **M33: Self-Directed Research**
  - [ ] Detect unanswered questions
  - [ ] Generate research hypotheses
  - [ ] Select research methods
  - [ ] Acquire evidence
  - [ ] Run experiments
  - [ ] Update epistemic memory
  - [ ] Revise hypotheses
  - [ ] Produce research artifacts
  - [ ] Reproducibility records
  - [ ] Human review boundaries
  - [ ] Identify questions worth investigating autonomously?

- [ ] **M34: Cognitive Continuity**
  - [ ] Runtime-independent identity state
  - [ ] Model-independent memory
  - [ ] Model replacement
  - [ ] Hardware migration
  - [ ] Instance migration
  - [ ] State reconstruction
  - [ ] Continuity verification
  - [ ] Capability changes across generations
  - [ ] Define continuity across self-modification

- [ ] **M35: ICOS Ecosystem**
  - [ ] External agents
  - [ ] External knowledge systems
  - [ ] Shared tool registries
  - [ ] Agent-to-agent protocols
  - [ ] Federated epistemic exchange
  - [ ] Trust / provenance between agents
  - [ ] Delegated authority
  - [ ] Inter-agent negotiation?
  - [ ] Multi-agent research / engineering?

- [ ] **M36: Open-Ended Research**
  - [ ] Re-evaluate architectural assumptions
  - [ ] Identify unexplained system behavior
  - [ ] Generate new research questions
  - [ ] Design experiments targeting those questions
  - [ ] Retire failed mechanisms
  - [ ] Introduce new capabilities without breaking established invariants
  - [ ] Maintain an explicit research frontier
  - [ ] Define the next generation of ICOS

- [ ] **M37: Advanced Perception**
  - [ ] Persistent visual perception
  - [ ] Person / object recognition
  - [ ] Spatial relationship understanding
  - [ ] Activity / behavior recognition
  - [ ] Multimodal identity cues
  - [ ] Biometric perception?
  - [ ] Face recognition / identity verification?
  - [ ] Privacy-preserving local inference?
  - [ ] Perception confidence and uncertainty
  - [ ] Persistent perceptual memory
  - [ ] Vision → epistemic memory integration

- [ ] **M38: Building-Scale Environment Control**
  - [ ] Building device registry
  - [ ] HVAC / climate control
  - [ ] Lighting
  - [ ] Access control
  - [ ] Cameras / security systems
  - [ ] Power monitoring and control
  - [ ] Appliances / machinery
  - [ ] Environmental sensors
  - [ ] Unified building state model
  - [ ] Cross-system automation
  - [ ] Physical action authorization
  - [ ] Safety interlocks
  - [ ] Human override
  - [ ] Building-wide event processing
  - [ ] Local operation during network failure
  - [ ] Building-scale autonomous management?

- [ ] **M39: Mobile Embodiment**
  - [ ] Mobile platform integration
  - [ ] Autonomous navigation
  - [ ] Dynamic obstacle avoidance
  - [ ] Spatial mapping
  - [ ] Person-aware navigation
  - [ ] Physical task execution
  - [ ] Charging / energy management
  - [ ] Docking / autonomous recovery
  - [ ] Mobile sensor platform
  - [ ] Environment → action → observation loop
  - [ ] Persistent physical-world state
  - [ ] Human / robot interaction
  - [ ] Autonomous operation boundaries

- [ ] **M40: Vehicle Embodiment**
  - [ ] Vehicle platform integration?
  - [ ] Drive-by-wire interface?
  - [ ] Vehicle sensor integration
  - [ ] Autonomous vehicle state model
  - [ ] Mobile compute / edge inference
  - [ ] Vehicle ↔ building ↔ ICOS coordination
  - [ ] Transformable mechanical platform?
  - [ ] Physical configuration state
  - [ ] Transformation planning and verification
  - [ ] Mechanical safety interlocks
  - [ ] Human override
