import { invoke } from "@tauri-apps/api/core";

export type MessageRole = "system" | "user" | "assistant";

export type BackendHealth = {
  status: "ok" | string;
  databaseUrl: string;
  threadCount: number;
};

export type Thread = {
  id: number;
  title: string;
  workspace: string | null;
  createdAt: string;
};

export type Message = {
  id: number;
  threadId: number;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type CreateThreadInput = {
  title: string;
  workspace?: string | null;
};

export type AddThreadMessageInput = {
  threadId: number;
  role: MessageRole;
  content: string;
};

export type ProviderKind = "github" | "gitlab";

export type ConnectProviderInput = {
  provider: ProviderKind;
  accessToken: string;
};

export type StartProviderDeviceAuthInput = {
  provider: ProviderKind;
};

export type StartProviderDeviceAuthResult = {
  provider: ProviderKind;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
};

export type PollProviderDeviceAuthInput = {
  provider: ProviderKind;
  deviceCode: string;
};

export type ProviderDeviceAuthStatus = "pending" | "slow_down" | "complete";

export type ProviderConnection = {
  provider: ProviderKind;
  accountLogin: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PollProviderDeviceAuthResult = {
  status: ProviderDeviceAuthStatus;
  connection: ProviderConnection | null;
};

export type CloneRepositoryInput = {
  provider: ProviderKind;
  repository: string;
  destinationRoot?: string | null;
  directoryName?: string | null;
  shallow?: boolean;
};

export type CloneRepositoryResult = {
  provider: ProviderKind;
  repository: string;
  workspace: string;
};

export type CompareWorkspaceDiffInput = {
  workspace: string;
  baseRef?: string | null;
  fetchRemote?: boolean;
};

export type CompareWorkspaceDiffProfile = {
  fetchOriginMs: number | null;
  resolveBaseRefMs: number;
  resolveHeadMs: number;
  resolveMergeBaseMs: number;
  diffMs: number;
  numstatMs: number;
  totalMs: number;
};

export type CompareWorkspaceDiffResult = {
  workspace: string;
  baseRef: string;
  mergeBase: string;
  head: string;
  diff: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  diffTruncated: boolean;
  diffBytesUsed: number;
  diffBytesTotal: number;
  profile: CompareWorkspaceDiffProfile;
};

export type ListWorkspaceBranchesInput = {
  workspace: string;
  fetchRemote?: boolean;
};

export type WorkspaceBranch = {
  name: string;
  isCurrent: boolean;
};

export type ListWorkspaceBranchesResult = {
  workspace: string;
  currentBranch: string | null;
  branches: WorkspaceBranch[];
  upstreamBranch: string | null;
  remoteBranches: WorkspaceBranch[];
  suggestedBaseRef: string;
};

export type CheckoutWorkspaceBranchInput = {
  workspace: string;
  branchName: string;
};

export type CheckoutWorkspaceBranchResult = {
  workspace: string;
  branchName: string;
};

export type CreateWorkspaceBranchInput = {
  workspace: string;
  branchName: string;
  fromRef?: string | null;
};

export type GenerateAiReviewInput = {
  threadId: number;
  workspace: string;
  baseRef: string;
  mergeBase: string;
  head: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  diff: string;
  prompt?: string | null;
};

export type AiReviewFinding = {
  id: string;
  filePath: string;
  chunkId: string;
  chunkIndex: number;
  hunkHeader: string;
  side: "additions" | "deletions" | string;
  lineNumber: number;
  title: string;
  body: string;
  severity: "critical" | "high" | "medium" | "low" | string;
  confidence: number | null;
};

export type AiReviewChunk = {
  id: string;
  filePath: string;
  chunkIndex: number;
  hunkHeader: string;
  summary: string;
  findings: AiReviewFinding[];
};

export type AiReviewProgressEvent = {
  runId: string | null;
  threadId: number;
  status:
    | "queued"
    | "started"
    | "chunk-start"
    | "chunk-complete"
    | "chunk-failed"
    | "finding"
    | "completed"
    | "completed_with_errors"
    | "canceled"
    | "failed"
    | string;
  message: string;
  totalChunks: number;
  completedChunks: number;
  chunkId: string | null;
  filePath: string | null;
  chunkIndex: number | null;
  findingCount: number | null;
  chunk: AiReviewChunk | null;
  finding: AiReviewFinding | null;
};

export type AiReviewRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceled"
  | string;

export type AiReviewRun = {
  runId: string;
  threadId: number;
  workspace: string;
  baseRef: string;
  mergeBase: string;
  head: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  prompt: string | null;
  scopeLabel: string | null;
  status: AiReviewRunStatus;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  findingCount: number;
  model: string | null;
  review: string | null;
  diffCharsUsed: number | null;
  diffCharsTotal: number | null;
  diffTruncated: boolean;
  error: string | null;
  chunks: AiReviewChunk[];
  findings: AiReviewFinding[];
  progressEvents: AiReviewProgressEvent[];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  canceledAt: string | null;
};

export type StartAiReviewRunInput = GenerateAiReviewInput & {
  scopeLabel?: string | null;
};

export type StartAiReviewRunResult = {
  run: AiReviewRun;
};

export type CancelAiReviewRunInput = {
  runId: string;
};

export type CancelAiReviewRunResult = {
  runId: string;
  canceled: boolean;
  status: string;
};

export type ListAiReviewRunsInput = {
  threadId?: number | null;
  limit?: number | null;
};

export type ListAiReviewRunsResult = {
  runs: AiReviewRun[];
};

export type GetAiReviewRunInput = {
  runId: string;
};

export type GenerateAiReviewResult = {
  threadId: number;
  workspace: string;
  baseRef: string;
  mergeBase: string;
  head: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  model: string;
  review: string;
  diffCharsUsed: number;
  diffCharsTotal: number;
  diffTruncated: boolean;
  chunks: AiReviewChunk[];
  findings: AiReviewFinding[];
};

export type GenerateAiFollowUpInput = {
  threadId: number;
  workspace: string;
  question: string;
};

export type GenerateAiFollowUpResult = {
  threadId: number;
  workspace: string;
  model: string;
  answer: string;
};

export type AiReviewConfig = {
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  envFilePath: string | null;
  reviewProvider: string;
  reviewModel: string;
  opencodeProvider: string;
  opencodeModel: string | null;
};

export type SetAiReviewApiKeyInput = {
  apiKey: string;
  persistToEnv?: boolean;
};

export type SetAiReviewSettingsInput = {
  reviewProvider: string;
  reviewModel: string;
  opencodeProvider?: string | null;
  opencodeModel?: string | null;
  persistToEnv?: boolean;
};

export type OpencodeSidecarStatus = {
  available: boolean;
  version: string | null;
  detail: string | null;
};

export type AppServerRateLimitWindow = {
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
};

export type AppServerCredits = {
  balance: string | null;
  hasCredits: boolean;
  unlimited: boolean;
};

export type AppServerRateLimits = {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: AppServerRateLimitWindow | null;
  secondary: AppServerRateLimitWindow | null;
  credits: AppServerCredits | null;
};

export type AppServerAccountStatus = {
  available: boolean;
  requiresOpenaiAuth: boolean;
  accountType: string | null;
  email: string | null;
  planType: string | null;
  rateLimits: AppServerRateLimits | null;
  detail: string | null;
};

export type AppServerLoginStartResult = {
  loginId: string;
  authUrl: string;
};

export function backendHealth() {
  return invoke<BackendHealth>("backend_health");
}

export function createThread(input: CreateThreadInput) {
  return invoke<Thread>("create_thread", { input });
}

export function listThreads(limit?: number) {
  return invoke<Thread[]>("list_threads", { limit });
}

export function deleteThread(threadId: number) {
  return invoke<boolean>("delete_thread", { threadId });
}

export function addThreadMessage(input: AddThreadMessageInput) {
  return invoke<Message>("add_thread_message", { input });
}

export function listThreadMessages(threadId: number, limit?: number) {
  return invoke<Message[]>("list_thread_messages", { threadId, limit });
}

export function connectProvider(input: ConnectProviderInput) {
  return invoke<ProviderConnection>("connect_provider", { input });
}

export function startProviderDeviceAuth(input: StartProviderDeviceAuthInput) {
  return invoke<StartProviderDeviceAuthResult>("start_provider_device_auth", { input });
}

export function pollProviderDeviceAuth(input: PollProviderDeviceAuthInput) {
  return invoke<PollProviderDeviceAuthResult>("poll_provider_device_auth", { input });
}

export function getProviderConnection(provider: ProviderKind) {
  return invoke<ProviderConnection | null>("get_provider_connection", { provider });
}

export function listProviderConnections() {
  return invoke<ProviderConnection[]>("list_provider_connections");
}

export function disconnectProvider(provider: ProviderKind) {
  return invoke<boolean>("disconnect_provider", { provider });
}

export function cloneRepository(input: CloneRepositoryInput) {
  return invoke<CloneRepositoryResult>("clone_repository", { input });
}

export function compareWorkspaceDiff(input: CompareWorkspaceDiffInput) {
  return invoke<CompareWorkspaceDiffResult>("compare_workspace_diff", { input });
}

export function listWorkspaceBranches(input: ListWorkspaceBranchesInput) {
  return invoke<ListWorkspaceBranchesResult>("list_workspace_branches", { input });
}

export function checkoutWorkspaceBranch(input: CheckoutWorkspaceBranchInput) {
  return invoke<CheckoutWorkspaceBranchResult>("checkout_workspace_branch", { input });
}

export function createWorkspaceBranch(input: CreateWorkspaceBranchInput) {
  return invoke<CheckoutWorkspaceBranchResult>("create_workspace_branch", { input });
}

export function getAiReviewConfig() {
  return invoke<AiReviewConfig>("get_ai_review_config");
}

export function setAiReviewApiKey(input: SetAiReviewApiKeyInput) {
  return invoke<AiReviewConfig>("set_ai_review_api_key", { input });
}

export function setAiReviewSettings(input: SetAiReviewSettingsInput) {
  return invoke<AiReviewConfig>("set_ai_review_settings", { input });
}

export function getOpencodeSidecarStatus() {
  return invoke<OpencodeSidecarStatus>("get_opencode_sidecar_status");
}

export function getAppServerAccountStatus() {
  return invoke<AppServerAccountStatus>("get_app_server_account_status");
}

export function startAppServerAccountLogin() {
  return invoke<AppServerLoginStartResult>("start_app_server_account_login");
}

export function generateAiReview(input: GenerateAiReviewInput) {
  return invoke<GenerateAiReviewResult>("generate_ai_review", { input });
}

export function startAiReviewRun(input: StartAiReviewRunInput) {
  return invoke<StartAiReviewRunResult>("start_ai_review_run", { input });
}

export function cancelAiReviewRun(input: CancelAiReviewRunInput) {
  return invoke<CancelAiReviewRunResult>("cancel_ai_review_run", { input });
}

export function listAiReviewRuns(input: ListAiReviewRunsInput = {}) {
  return invoke<ListAiReviewRunsResult>("list_ai_review_runs", { input });
}

export function getAiReviewRun(input: GetAiReviewRunInput) {
  return invoke<AiReviewRun>("get_ai_review_run", { input });
}

export function generateAiFollowUp(input: GenerateAiFollowUpInput) {
  return invoke<GenerateAiFollowUpResult>("generate_ai_follow_up", { input });
}
