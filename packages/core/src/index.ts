export * from './types.js';
export * from './errors.js';

export { Engine, defaultRoot } from './container/engine.js';
export type { EngineOptions } from './container/engine.js';

export {
  ESTABLISHED_AT,
  PROVISIONAL_AT,
  RETHINK_AFTER,
  assess,
  discriminators,
  fingerprint,
  guide,
  independentSuccesses,
} from './harness/learning.js';
export type {
  Assessment,
  Confidence,
  Context,
  Discriminator,
  Guidance,
  Outcome,
  Strategy,
} from './harness/learning.js';

export { QuestionBroker } from './harness/ask.js';
export {
  BUILTIN_SKILLS,
  SkillRegistry,
  createSkillTool,
  parseSkill,
  skillTool,
  writeSkill,
} from './harness/skills.js';
export type {
  Skill,
  SkillDraft,
  SkillPackage,
  SkillScope,
  SkillSources,
} from './harness/skills.js';
export {
  McpRegistry,
  expandMcpEnvironment,
  missingMcpCredentials,
  parseServerConfigs,
  qualifiedToolName,
  resolveServerConfigs,
} from './harness/mcp.js';
export { installMarketplacePlugin } from './marketplace/catalog.js';
export type { HttpServerConfig, McpLoginResult, McpRegistryOptions, McpServerConfig, McpServerStatus, StdioServerConfig } from './harness/mcp.js';
export {
  McpOAuthCoordinator,
  McpOAuthProvider,
  oauthBrowserCommand,
  openOAuthBrowser,
  validateOAuthAuthorizationUrl,
} from './auth/mcp-oauth.js';
export type { McpAuthEvent, McpOAuthConfig, McpOAuthCoordinatorOptions } from './auth/mcp-oauth.js';
export { CredentialBroker, MemorySecretStore, WindowsDpapiSecretStore } from './auth/secrets.js';
export type { CredentialRequest, CredentialBrokerOptions, SecretStore } from './auth/secrets.js';
export { MemoryMcpOAuthStore, WindowsDpapiOAuthStore, mcpOAuthKey } from './auth/store.js';
export type { McpOAuthStore, OAuthCredentialScope, StoredMcpOAuthState } from './auth/store.js';
export type { Question, QuestionChoice } from './harness/ask.js';
export type { QuestionOption } from './events/bus.js';
export { runLoop, runCompaction } from './harness/loop.js';
export type { CompactionRun } from './harness/loop.js';
export { COMPACTION_STAGES, compact, estimateTokens, pinnedIndices } from './harness/compaction.js';
export type { CompactionOptions, CompactionResult } from './harness/compaction.js';
export { MemoryStore, rankFacts, strategyId, strategyStatus, summariseMemory } from './harness/memory.js';
export type { Fact, FactKind, MemorySnapshot } from './harness/memory.js';
export { DEFAULT_CONTEXT_TOKENS } from './harness/loop.js';
export type { LoopOptions, LoopResult, LoopStop } from './harness/loop.js';
export { buildSystemPrompt } from './harness/prompt.js';
export type { PromptContext, PromptMode, PromptModule } from './harness/prompt.js';
export { detectShell, resetShellCache, shellSection } from './harness/environment.js';
export type { ShellReport } from './harness/environment.js';
export {
  DEFAULT_TOOLS,
    askUser,
    getConfig,
    updateConfig,
  updatePlan,
  applyPatch,
  editFile,
  globFiles,
  grepFiles,
  listDir,
  readFile,
  remember,
  runCommand,
  toolRegistry,
  toolSpecs,
  writeFile,
  editConflicts,
  resolveEditConflict,
  listProfiles,
  createProfile,
  activateProfile,
} from './harness/tools.js';
export type { PlanCheckpoint, PlanStatus, Tool, ToolContext, ToolResult } from './harness/tools.js';

export { TaskManager } from './tasks/manager.js';
export type {
  StartTaskInput,
  TaskContainer,
  TaskSnapshot,
  TaskStatus,
} from './tasks/manager.js';
export { classifyDangerousCommand } from './tasks/dangerous.js';

export { LspClient } from './lsp/client.js';
export type { Diagnostic, Location, Severity, SymbolInfo } from './lsp/client.js';
export { LspManager, countBySeverity, formatDiagnostics } from './lsp/manager.js';
export type { LspManagerOptions, LspStatus } from './lsp/manager.js';
export { diagnosticsAfterWrite, lspTools } from './lsp/tools.js';
export { SERVERS, detectLanguages, languageIdFor, resolveServer, serverFor } from './lsp/servers.js';
export type { ResolvedServer, ServerSpec } from './lsp/servers.js';

export { OpenAIProvider } from './model/openai.js';
export { ReasoningSplitter, reasoningFromDelta } from './model/reasoning.js';
export type { ReasoningSplit } from './model/reasoning.js';
export { collect, NO_USAGE } from './model/provider.js';
export type {
  Attachment,
  CompletionEvent,
  CompletionRequest,
  FinishReason,
  Message,
  ModelInfo,
  ModelProvider,
  Role,
  ToolCall,
  ToolSpec,
  Usage,
} from './model/provider.js';
export {
  PRESETS,
  describe,
  isFreeModel,
  isLocal,
  keyOptional,
  formatModelRef,
  loadStoredConfig,
  parseModelRef,
  redact,
  resolveConfig,
  saveStoredConfig,
  validate as validateModelConfig,
  visionCandidates,
} from './model/config.js';
export type {
  CustomProvider,
  CustomProviderModel,
  ModelCapability,
  ModelCost,
  Effort,
  ModelConfig,
  ModelRef,
  PresetName,
  ResolveOptions,
  StoredConfig,
  VisionCandidate,
} from './model/config.js';
export {
  MODEL_CATALOG,
  MODEL_CATALOG_DEFAULT,
  catalogSelection,
  findCatalogModel,
} from './model/catalog.js';
export type { ModelCatalogModel, ModelCatalogProvider, ModelSelection } from './model/catalog.js';

export { Session, SessionStore, workspaceKey } from './session/store.js';
export type { SessionMeta, TranscriptEvent } from './session/store.js';
export {
  adaptLegacyTranscriptEvent,
  decodeConversationEvent,
  decodeLegacyTranscriptEvent,
  dedupeConversationEvents,
  eventBase,
  recoverInterruptedTurns,
} from './session/events.js';
export type {
  ConversationEvent,
  ConversationEventV1,
  LegacyAdaptContext,
  LegacyTranscriptEvent,
} from './session/events.js';
export { declaredServers, manifestBaseUrls } from './marketplace/catalog.js';
export { checkForUpdate, isNewer } from './update/check.js';
export type { UpdateStatus, UpdateCheckOptions } from './update/check.js';
export { conversationFromTranscript } from './session/resume.js';
export type { ResumeOptions } from './session/resume.js';
export { Container } from './container/container.js';
export type { ContainerDeps } from './container/container.js';
export { generateName, isValidName } from './container/names.js';

export { EventBus } from './events/bus.js';
export type { EventName, Handler, PlifEvents } from './events/bus.js';

export { AuditLog } from './audit/log.js';
export type { AuditEventType, AuditRecord } from './audit/log.js';

export {
  CONFIG_SCHEMA_URL,
  agentsOf,
  mcpServersOf,
  globalConfigPath,
  isAutoApproveEnabled,
  loadGlobalConfig,
  permissionMode,
  saveGlobalConfig,
  setPermissionMode,
  setAutoApprove,
  profilesOf,
} from './config/global.js';
export { stripJsonComments } from './config/global.js';
export type { AgentConfig, GlobalConfig, PermissionMode, ProfileConfig } from './config/global.js';

export {
  DEVELOPER_POLICY,
  PolicyEngine,
  STRICT_POLICY,
  matchGlob,
} from './policy/policy.js';
export type {
  Decision,
  PolicyAction,
  PolicyDocument,
  PolicyRule,
  PolicyVerdict,
  TrustTier,
} from './policy/policy.js';
export { ApprovalBroker, denialError } from './policy/approval.js';
export type { ApprovalAnswer, ApprovalQuestion } from './policy/approval.js';

export { PathJail, isPathInside, normalizeVirtualPath } from './fs/vpath.js';
export type { JailConfig, ResolvedPath } from './fs/vpath.js';
export { commit, flatten, layerFromDirectory, materialize } from './fs/overlay.js';
export type { MaterializeOptions, MaterializeResult, PlacementMode } from './fs/overlay.js';

export { ContentStore, digestOf } from './store/content.js';
export { ImageStore, LayerStore, canonicalJson, normalizeReference } from './store/images.js';
export { StorePaths } from './store/paths.js';

export {
  MARKETPLACES,
  categoriesOf,
  loadCatalog,
  searchPlugins,
  sourceUrl,
} from './marketplace/catalog.js';
export type {
  Catalog,
  CatalogOptions,
  CatalogPlugin,
  MarketplaceSource,
  PluginSource,
} from './marketplace/catalog.js';

export { SubagentCoordinator, subagentTool, subagentTools } from './harness/subagent.js';
export type { SubagentOptions } from './harness/subagent.js';
export { readAgentInstructions } from './harness/prompt.js';
export { routeVision, visionModelRef, visionTools } from './harness/vision.js';
export type { VisionRoute } from './harness/vision.js';
export {
  describeStats,
  diffLines,
  diffStats,
  formatDiff,
  hunksOf,
  parseDiff,
} from './harness/diff.js';
export type { DiffHunk, DiffLine, DiffOp, DiffStats } from './harness/diff.js';
export { EditCoordinator } from './harness/edits.js';
export type { EditConflict } from './harness/edits.js';
export {
  AUTO_COMPACTION_TARGET_RATIO,
  AUTO_COMPACTION_TRIGGER_RATIO,
  autoCompactionTarget,
  scheduleBatches,
  shouldAutoCompact,
} from './harness/loop.js';

export { SEARCH_HOSTS, parseResults, resolveRedirect, search, stripTags } from './web/duckduckgo.js';
export type { InstantAnswer, SearchOptions, SearchResponse, SearchResult } from './web/duckduckgo.js';
export { WEB_TOOLS, curl, webFetch, webSearch } from './web/tools.js';
