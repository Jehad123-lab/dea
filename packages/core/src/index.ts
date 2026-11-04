export { classify as classifyAsset, gltfSummary, ktx2Summary, lottieSummary, parseGlb, riveSummary } from './assets/files.ts';
export {
  type AssetsDoc,
  type AssetsOptions,
  type AssetsResult,
  decodeAssets,
  drives,
  type NetworkAsset,
  renderAssetsMd,
  type TextureInfo,
} from './assets/index.ts';
export { programName, samplerRole, samplerUse } from './assets/roles.ts';
export {
  type InvestigateOptions,
  type InvestigateResult,
  investigateInBackground,
  investigationStatus,
  prepareInvestigation,
  readCheckpoint,
  runInvestigation,
  writeReport,
} from './brain/investigate.ts';
export { brainFromEnv, checkCitations } from './brain/llm.ts';
export { goalTerms, matchedTerms, pageTerms, planInvestigation, rankLinks } from './brain/planner.ts';
export type { Brain, Checkpoint, Claim, EvidenceRef, InvestigationPlan, PlanStep, StepKind, StepState } from './brain/types.ts';
export {
  type BrowserChoice,
  browserInfo,
  installObservers,
  isShared,
  launchBrowser,
  normalizeUrl,
  type OpenOptions,
  openSite,
  releaseBrowser,
  type Session,
  settle,
  withSharedBrowser,
} from './browser/open.ts';
export { type CacheOptions, type CacheStats, ContentCache, cacheKey, currentCache, fmtMb, withCache } from './cache.ts';
export { type ApiCall, buildOpenApi, inferSchema, isApiCall, isAssetUrl, isTelemetry, mergeSchema, templatePath } from './code/api.ts';
export { type CodeDoc, type CodeOptions, type CodeResult, decodeCode } from './code/decode.ts';
export { CodeIndex, type Excerpt } from './code/excerpt.ts';
export { linkData } from './code/explain.ts';
export { CODE_INIT_SCRIPT } from './code/hooks.ts';
export {
  apiGaps,
  type CdpInitiator,
  describeInitiator,
  endpointNeedles,
  findInScripts,
  flattenInitiator,
  framesToStack,
  type Initiator,
  initiatorText,
} from './code/initiator.ts';
export { parseStack } from './code/runtime.ts';
export { detectBundler, type ScriptRecord, safeSourcePath, sourceMapRef } from './code/scripts.ts';
export type { ApiEndpoint, ScriptSource } from './code/types.ts';
export { explainPrograms, uniformMeaning } from './code/uniforms.ts';
export { unpack } from './code/unpack.ts';
export { checkScripts, cmpVersion } from './code/vulns.ts';
export {
  classifyDriver,
  type Driver,
  driverText,
  fit as fitLine,
  renderTraceMd,
  TRACE_INIT_SCRIPT,
  type TraceDoc,
  type TraceOptions,
  traceGaps,
  traceWebGL,
  type UniformTrace,
} from './debug/trace.ts';
export { colorName, contrast, groupColors } from './design/colors.ts';
export { easingName } from './design/css.ts';
export { type DesignDoc, type DesignOptions, type DesignResult, decodeDesign, designSummary } from './design/index.ts';
export { parseShader, summarizeShaders } from './design/shaders.ts';
export { streamRun } from './events.ts';
export { deaHome, isRunId, listRuns, newRunId, type RunSummary, RunWriter, readRun, resolveRun, runsDir } from './evidence/run.ts';
export { isSecretHeader, isSecretParam, redactBody, redactText, redactUrl, stripHar } from './evidence/secrets.ts';
export {
  driversCode,
  guessDriver,
  type HeroLayout,
  heroHtml,
  heroJsx,
  heroStyles,
  keyframesCss,
  type Observed,
  observedLiteral,
  type PipelinePass,
  type ProgramSource,
  particlesStandin,
  pickPrograms,
  pipelineModule,
  projectFiles,
  type ShaderModule,
  type Standin,
  sceneCss,
  shaderModule,
  shaderName,
  type Target,
  tokenFiles,
} from './extract/generate.ts';
export { type ExtractOptions, type ExtractResult, extract, extractGaps, filterTree, observedFrom } from './extract/index.ts';
export {
  type KitManifest,
  kitDir,
  type LibraryEntry,
  libraryAdd,
  libraryHome,
  libraryList,
  libraryRemove,
  librarySearch,
  libraryUse,
  scoreEntry,
} from './extract/library.ts';
export {
  analyse,
  detectTechniques,
  duckDuckGo,
  type Finding,
  githubCode,
  type Hint,
  type Knob,
  type Params,
  providersFromEnv,
  type ResearchResult,
  rateLimited,
  researchLoop,
  researchTechniques,
  type SearchProvider,
  searxng,
  type Technique,
} from './extract/research.ts';
export { type CanvasScore, canvasLine, canvasScore, type ScoreFilesResult, scoreFiles } from './extract/score.ts';
export { COVERS, type Gap, type ProbeStep, renderGaps } from './gaps.ts';
export { dispatch, SESSION_METHODS, SessionClient, type SessionInfo, type SessionMethod, serveSession, sessionFile } from './hands/daemon.ts';
export { type ActionResult, type ElementInfo, type HandsOptions, HandsSession, type LoggedAction, redactArgs, renderSessionReport } from './hands/session.ts';
export { CATALOG, type CatalogEntry, findCatalog } from './hub/catalog.ts';
export { connectServer, DEFAULT_CALLBACK_PORT, expandEnv, HubOAuth, listAllTools, type ToolInfo, waitForCallback } from './hub/client.ts';
export { type CallResult, Hub, qualify, SEP, unqualify } from './hub/hub.ts';
export { grantFor, type HistoryLine, isDestructive, isReadOnly, logCall, mayCall, overLimit, readHistory, summarizeArgs, visibleTools } from './hub/policy.ts';
export {
  type AppGrant,
  type ClientDef,
  checkName,
  DEFAULT_CONFIG,
  type HubConfig,
  hubHome,
  LEVELS,
  type Level,
  loadHub,
  parseServersConfig,
  SecretStore,
  type ServerDef,
  saveHub,
  updateHub,
} from './hub/store.ts';
export { describeFit, easeNames, type Fit, fitSeries, gsapFor, nameEase, unwrapDegrees } from './motion/fit.ts';
export {
  decodeMotion,
  decomposeTransform,
  type GsapNode,
  gsapModule,
  type MotionDoc,
  type MotionOptions,
  type MotionResult,
  renderMotionMd,
} from './motion/index.ts';
export { renderReport } from './report.ts';
export {
  type ActionKind,
  type ActionRequest,
  checkAction,
  DEFAULT_POLICY,
  type Decision,
  decide,
  domainAllowed,
  isSecretField,
  loadPolicy,
  looksLikeSubmit,
  MODES,
  type Mode,
  type Policy,
  type PolicyFile,
  parsePolicy,
  sensitiveForm,
  type Verdict,
} from './safety/policy.ts';
export { collect, type InspectOptions, type InspectResult, inspectSite, type RunDoc, stackSite, summarize } from './see/inspect.ts';
export { classify, fmtBytes, type NetworkSummary, summarize as summarizeHar } from './see/network.ts';
export { detectStack, KNOWN_TECH, type StackHit, type StackSignals } from './see/stack.ts';
export {
  currentTimings,
  renderTimings,
  type StageTiming,
  Timings,
  type TimingsDoc,
  timed,
  treeRss,
  withTimings,
} from './timings.ts';
export type { DeaEvent, EventSink, Evidence, Fact, Label, RunMeta } from './types.ts';
