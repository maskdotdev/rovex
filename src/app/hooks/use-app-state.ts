import { createMemo, createResource, createSignal } from "solid-js";
import type { DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  getDiffThemePreset,
  getInitialDiffThemeId,
  getInitialKnownRepoWorkspaces,
  getInitialMaskAccountEmail,
  getInitialRepoDisplayNames,
  getInitialRepoReviewDefaults,
  getInitialReviewSidebarCollapsed,
  groupThreadsByRepo,
  providerOption,
} from "@/app/helpers";
import type { AppView, RepoReview, RepoReviewDefaults, SettingsTab } from "@/app/types";
import { createFullReviewScope, type ReviewScope } from "@/app/review-scope";
import type { ReviewRun, ReviewWorkbenchTab } from "@/app/review-types";
import {
  getAppServerAccountStatus,
  getAiReviewConfig,
  getOpencodeSidecarStatus,
  getProviderConnection,
  listAiReviewRuns,
  listThreadMessages,
  listWorkspaceBranches,
  listThreads,
  type AppServerAccountStatus,
  type AiReviewChunk,
  type AiReviewConfig,
  type AiReviewFinding,
  type AiReviewProgressEvent,
  type AiReviewRun as PersistedAiReviewRun,
  type CompareWorkspaceDiffResult,
  type ListWorkspaceBranchesResult,
  type Message as ThreadMessage,
  type OpencodeSidecarStatus,
  type ProviderConnection,
  type ProviderKind,
} from "@/lib/backend";

export function useAppState() {
  const [threads, { refetch: refetchThreads }] = createResource(() => listThreads(200));
  const [githubConnection, { refetch: refetchGithubConnection }] = createResource<
    ProviderConnection | null
  >(() => getProviderConnection("github"));
  const [gitlabConnection, { refetch: refetchGitlabConnection }] = createResource<
    ProviderConnection | null
  >(() => getProviderConnection("gitlab"));

  const [activeView, setActiveView] = createSignal<AppView>("workspace");
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTab>("connections");
  const [selectedDiffThemeId, setSelectedDiffThemeId] = createSignal(getInitialDiffThemeId());
  const [maskAccountEmail, setMaskAccountEmail] = createSignal(getInitialMaskAccountEmail());
  const [reviewSidebarCollapsed, setReviewSidebarCollapsed] = createSignal(
    getInitialReviewSidebarCollapsed()
  );
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderKind>("github");
  const selectedDiffTheme = createMemo(() => getDiffThemePreset(selectedDiffThemeId()));
  const selectedProviderOption = createMemo(() => providerOption(selectedProvider()));
  const selectedProviderConnection = createMemo(() =>
    selectedProvider() === "github" ? githubConnection() : gitlabConnection()
  );

  const [knownRepoWorkspaces, setKnownRepoWorkspaces] = createSignal<Record<string, string>>(
    getInitialKnownRepoWorkspaces()
  );
  const repoGroups = createMemo(() => groupThreadsByRepo(threads() ?? [], knownRepoWorkspaces()));
  const [collapsedRepos, setCollapsedRepos] = createSignal<Record<string, boolean>>({});
  const [repoDisplayNames, setRepoDisplayNames] = createSignal<Record<string, string>>(
    getInitialRepoDisplayNames()
  );
  const [reviewDefaultsByRepo, setReviewDefaultsByRepo] = createSignal<
    Record<string, RepoReviewDefaults>
  >(getInitialRepoReviewDefaults());
  const [repoMenuOpen, setRepoMenuOpen] = createSignal<Record<string, boolean>>({});
  const [selectedThreadId, setSelectedThreadId] = createSignal<number | null>(null);
  const [providerToken, setProviderToken] = createSignal("");
  const [repositoryInput, setRepositoryInput] = createSignal("");
  const [destinationRoot, setDestinationRoot] = createSignal("");
  const [localProjectPath, setLocalProjectPath] = createSignal("");
  const [providerBusy, setProviderBusy] = createSignal(false);
  const [providerError, setProviderError] = createSignal<string | null>(null);
  const [providerStatus, setProviderStatus] = createSignal<string | null>(null);
  const [deviceAuthInProgress, setDeviceAuthInProgress] = createSignal(false);
  const [deviceAuthUserCode, setDeviceAuthUserCode] = createSignal<string | null>(null);
  const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] = createSignal<string | null>(null);
  const [compareBusy, setCompareBusy] = createSignal(false);
  const [compareError, setCompareError] = createSignal<string | null>(null);
  const [compareResult, setCompareResult] = createSignal<CompareWorkspaceDiffResult | null>(null);
  const [showDiffViewer, setShowDiffViewer] = createSignal(false);
  const [selectedBaseRef, setSelectedBaseRef] = createSignal("origin/main");
  const [branchPopoverOpen, setBranchPopoverOpen] = createSignal(false);
  const [branchSearchQuery, setBranchSearchQuery] = createSignal("");
  const [branchCreateMode, setBranchCreateMode] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal("");
  const [branchActionBusy, setBranchActionBusy] = createSignal(false);
  const [branchActionError, setBranchActionError] = createSignal<string | null>(null);
  const [aiPrompt, setAiPrompt] = createSignal("");
  const [aiReviewBusy, setAiReviewBusy] = createSignal(false);
  const [aiFollowUpBusy, setAiFollowUpBusy] = createSignal(false);
  const [aiReviewError, setAiReviewError] = createSignal<string | null>(null);
  const [aiStatus, setAiStatus] = createSignal<string | null>(null);
  const [aiRunElapsedSeconds, setAiRunElapsedSeconds] = createSignal(0);
  const [aiApiKeyInput, setAiApiKeyInput] = createSignal("");
  const [aiApiKeyBusy, setAiApiKeyBusy] = createSignal(false);
  const [aiApiKeyError, setAiApiKeyError] = createSignal<string | null>(null);
  const [aiApiKeyStatus, setAiApiKeyStatus] = createSignal<string | null>(null);
  const [aiReviewProviderInput, setAiReviewProviderInput] = createSignal("openai");
  const [aiReviewModelInput, setAiReviewModelInput] = createSignal("gpt-4.1-mini");
  const [aiOpencodeProviderInput, setAiOpencodeProviderInput] = createSignal("openai");
  const [aiOpencodeModelInput, setAiOpencodeModelInput] = createSignal("");
  const [aiSettingsBusy, setAiSettingsBusy] = createSignal(false);
  const [aiSettingsError, setAiSettingsError] = createSignal<string | null>(null);
  const [aiSettingsStatus, setAiSettingsStatus] = createSignal<string | null>(null);
  const [appServerAuthBusy, setAppServerAuthBusy] = createSignal(false);
  const [appServerAuthError, setAppServerAuthError] = createSignal<string | null>(null);
  const [appServerAuthStatus, setAppServerAuthStatus] = createSignal<string | null>(null);
  const [aiChunkReviews, setAiChunkReviews] = createSignal<AiReviewChunk[]>([]);
  const [aiFindings, setAiFindings] = createSignal<AiReviewFinding[]>([]);
  const [aiProgressEvents, setAiProgressEvents] = createSignal<AiReviewProgressEvent[]>([]);
  const [activeReviewScope, setActiveReviewScope] = createSignal<ReviewScope>(
    createFullReviewScope()
  );
  const [reviewRuns, setReviewRuns] = createSignal<ReviewRun[]>([]);
  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
  const [reviewWorkbenchTab, setReviewWorkbenchTab] =
    createSignal<ReviewWorkbenchTab>("description");

  let branchSearchInputRef: HTMLInputElement | undefined;
  let branchCreateInputRef: HTMLInputElement | undefined;

  const setBranchSearchInputRef = (element: HTMLInputElement | undefined) => {
    branchSearchInputRef = element;
  };

  const setBranchCreateInputRef = (element: HTMLInputElement | undefined) => {
    branchCreateInputRef = element;
  };

  const getBranchSearchInputRef = () => branchSearchInputRef;
  const getBranchCreateInputRef = () => branchCreateInputRef;

  const selectedReview = createMemo<RepoReview | undefined>(() => {
    const selected = selectedThreadId();
    if (selected == null) return undefined;

    for (const group of repoGroups()) {
      const review = group.reviews.find((candidate) => candidate.id === selected);
      if (review) return review;
    }

    return undefined;
  });

  const compareSummary = createMemo(() => {
    const result = compareResult();
    if (!result) return null;
    const bytesLabel = result.diffBytesTotal >= 1024 * 1024
      ? `${(result.diffBytesTotal / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(result.diffBytesTotal / 1024))} KB`;
    const truncatedSuffix = result.diffTruncated
      ? ` (truncated to ${Math.max(1, Math.round(result.diffBytesUsed / 1024))} KB)`
      : "";
    return `${result.filesChanged} files changed +${result.insertions} -${result.deletions} vs ${result.baseRef} • ${bytesLabel}${truncatedSuffix} • ${result.profile.totalMs}ms`;
  });

  const diffAnnotations = createMemo<DiffViewerAnnotation[]>(() =>
    aiFindings().map((finding) => {
      const normalizedSide: DiffViewerAnnotation["side"] =
        finding.side === "deletions" ? "deletions" : "additions";
      return {
        id: finding.id,
        filePath: finding.filePath,
        side: normalizedSide,
        lineNumber: finding.lineNumber,
        title: finding.title,
        body: finding.body,
        severity: finding.severity,
        chunkId: finding.chunkId,
      };
    })
  );

  const selectedWorkspace = createMemo(() => selectedReview()?.workspace?.trim() ?? "");

  const [workspaceBranches, { refetch: refetchWorkspaceBranches }] = createResource(
    selectedWorkspace,
    async (workspace): Promise<ListWorkspaceBranchesResult | null> => {
      const normalizedWorkspace = workspace.trim();
      if (!normalizedWorkspace) return null;
      return listWorkspaceBranches({ workspace: normalizedWorkspace });
    }
  );
  const [threadMessages, { refetch: refetchThreadMessages }] = createResource(
    selectedThreadId,
    async (threadId): Promise<ThreadMessage[]> => {
      if (threadId == null) return [];
      return listThreadMessages(threadId, 100);
    }
  );
  const [persistedReviewRuns, { refetch: refetchAiReviewRuns }] = createResource(
    selectedThreadId,
    async (threadId): Promise<PersistedAiReviewRun[]> => {
      if (threadId == null) return [];
      const response = await listAiReviewRuns({ threadId, limit: 50 });
      return response.runs;
    }
  );
  const [aiReviewConfig, { refetch: refetchAiReviewConfig }] = createResource<AiReviewConfig>(
    () => getAiReviewConfig()
  );
  const [appServerAccountStatus, { refetch: refetchAppServerAccountStatus }] =
    createResource<AppServerAccountStatus>(() => getAppServerAccountStatus());
  const [opencodeSidecarStatus, { refetch: refetchOpencodeSidecarStatus }] =
    createResource<OpencodeSidecarStatus>(() => getOpencodeSidecarStatus());

  const currentWorkspaceBranch = createMemo(() => {
    const result = workspaceBranches();
    if (!result) return "main";
    return result.currentBranch?.trim() || "HEAD";
  });
  const filteredWorkspaceBranches = createMemo(() => {
    const query = branchSearchQuery().trim().toLowerCase();
    const branches = workspaceBranches()?.branches ?? [];
    if (!query) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(query));
  });
  const canCreateBranch = createMemo(
    () => !branchActionBusy() && newBranchName().trim().length > 0
  );

  const loadError = createMemo(() => {
    const error = threads.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });

  const providerConnectionError = createMemo(() => {
    const error = selectedProvider() === "github" ? githubConnection.error : gitlabConnection.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });
  const workspaceBranchLoadError = createMemo(() => {
    const error = workspaceBranches.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });
  const threadMessagesLoadError = createMemo(() => {
    const error = threadMessages.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });
  const aiReviewConfigLoadError = createMemo(() => {
    const error = aiReviewConfig.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });
  const opencodeSidecarLoadError = createMemo(() => {
    const error = opencodeSidecarStatus.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });
  const appServerAccountLoadError = createMemo(() => {
    const error = appServerAccountStatus.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });

  return {
    threads,
    refetchThreads,
    githubConnection,
    refetchGithubConnection,
    gitlabConnection,
    refetchGitlabConnection,
    activeView,
    setActiveView,
    activeSettingsTab,
    setActiveSettingsTab,
    selectedDiffThemeId,
    setSelectedDiffThemeId,
    maskAccountEmail,
    setMaskAccountEmail,
    reviewSidebarCollapsed,
    setReviewSidebarCollapsed,
    settingsError,
    setSettingsError,
    selectedProvider,
    setSelectedProvider,
    selectedDiffTheme,
    selectedProviderOption,
    selectedProviderConnection,
    knownRepoWorkspaces,
    setKnownRepoWorkspaces,
    repoGroups,
    collapsedRepos,
    setCollapsedRepos,
    repoDisplayNames,
    setRepoDisplayNames,
    reviewDefaultsByRepo,
    setReviewDefaultsByRepo,
    repoMenuOpen,
    setRepoMenuOpen,
    selectedThreadId,
    setSelectedThreadId,
    providerToken,
    setProviderToken,
    repositoryInput,
    setRepositoryInput,
    destinationRoot,
    setDestinationRoot,
    localProjectPath,
    setLocalProjectPath,
    providerBusy,
    setProviderBusy,
    providerError,
    setProviderError,
    providerStatus,
    setProviderStatus,
    deviceAuthInProgress,
    setDeviceAuthInProgress,
    deviceAuthUserCode,
    setDeviceAuthUserCode,
    deviceAuthVerificationUrl,
    setDeviceAuthVerificationUrl,
    compareBusy,
    setCompareBusy,
    compareError,
    setCompareError,
    compareResult,
    setCompareResult,
    showDiffViewer,
    setShowDiffViewer,
    selectedBaseRef,
    setSelectedBaseRef,
    branchPopoverOpen,
    setBranchPopoverOpen,
    branchSearchQuery,
    setBranchSearchQuery,
    branchCreateMode,
    setBranchCreateMode,
    newBranchName,
    setNewBranchName,
    branchActionBusy,
    setBranchActionBusy,
    branchActionError,
    setBranchActionError,
    aiPrompt,
    setAiPrompt,
    aiReviewBusy,
    setAiReviewBusy,
    aiFollowUpBusy,
    setAiFollowUpBusy,
    aiReviewError,
    setAiReviewError,
    aiStatus,
    setAiStatus,
    aiRunElapsedSeconds,
    setAiRunElapsedSeconds,
    aiApiKeyInput,
    setAiApiKeyInput,
    aiApiKeyBusy,
    setAiApiKeyBusy,
    aiApiKeyError,
    setAiApiKeyError,
    aiApiKeyStatus,
    setAiApiKeyStatus,
    aiReviewProviderInput,
    setAiReviewProviderInput,
    aiReviewModelInput,
    setAiReviewModelInput,
    aiOpencodeProviderInput,
    setAiOpencodeProviderInput,
    aiOpencodeModelInput,
    setAiOpencodeModelInput,
    aiSettingsBusy,
    setAiSettingsBusy,
    aiSettingsError,
    setAiSettingsError,
    aiSettingsStatus,
    setAiSettingsStatus,
    appServerAuthBusy,
    setAppServerAuthBusy,
    appServerAuthError,
    setAppServerAuthError,
    appServerAuthStatus,
    setAppServerAuthStatus,
    aiChunkReviews,
    setAiChunkReviews,
    aiFindings,
    setAiFindings,
    aiProgressEvents,
    setAiProgressEvents,
    activeReviewScope,
    setActiveReviewScope,
    reviewRuns,
    setReviewRuns,
    selectedRunId,
    setSelectedRunId,
    reviewWorkbenchTab,
    setReviewWorkbenchTab,
    selectedReview,
    compareSummary,
    diffAnnotations,
    selectedWorkspace,
    workspaceBranches,
    refetchWorkspaceBranches,
    threadMessages,
    refetchThreadMessages,
    persistedReviewRuns,
    refetchAiReviewRuns,
    aiReviewConfig,
    refetchAiReviewConfig,
    appServerAccountStatus,
    refetchAppServerAccountStatus,
    opencodeSidecarStatus,
    refetchOpencodeSidecarStatus,
    currentWorkspaceBranch,
    filteredWorkspaceBranches,
    canCreateBranch,
    loadError,
    providerConnectionError,
    workspaceBranchLoadError,
    threadMessagesLoadError,
    aiReviewConfigLoadError,
    opencodeSidecarLoadError,
    appServerAccountLoadError,
    setBranchSearchInputRef,
    setBranchCreateInputRef,
    getBranchSearchInputRef,
    getBranchCreateInputRef,
  };
}
