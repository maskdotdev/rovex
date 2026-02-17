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

export type ProviderKind = "github";

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

export type CompareWorkspaceDiffResult = {
  workspace: string;
  baseRef: string;
  mergeBase: string;
  head: string;
  diff: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
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

export function generateAiReview(input: GenerateAiReviewInput) {
  return invoke<GenerateAiReviewResult>("generate_ai_review", { input });
}
