import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import type { DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/sidebar";
import {
  ACCOUNT_EMAIL_MASK_STORAGE_KEY,
  REPO_REVIEW_DEFAULTS_STORAGE_KEY,
  REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "@/app/constants";
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
import { SettingsView } from "@/app/components/settings-view";
import { WorkspaceHeader } from "@/app/components/workspace-header";
import { WorkspaceMainPane } from "@/app/components/workspace-main-pane";
import { WorkspaceRepoSidebar } from "@/app/components/workspace-repo-sidebar";
import { WorkspaceReviewSidebar } from "@/app/components/workspace-review-sidebar";
import { useAppEffects } from "@/app/hooks/use-app-effects";
import { useProviderAndSettingsActions } from "@/app/hooks/use-provider-and-settings-actions";
import { useReviewActions } from "@/app/hooks/use-review-actions";
import type { AppView, RepoReview, RepoReviewDefaults, SettingsTab } from "@/app/types";
import {
  createFullReviewScope,
  type ReviewScope,
} from "@/app/review-scope";
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
import "./app.css";

function App() {
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
    return `${result.filesChanged} files changed +${result.insertions} -${result.deletions} vs ${result.baseRef}`;
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
  createEffect(() => {
    const runs = persistedReviewRuns();
    if (!runs) return;
    setReviewRuns(
      runs.map((run) => ({
        id: run.runId,
        status: run.status as ReviewRun["status"],
        scope: createFullReviewScope(),
        scopeLabel: run.scopeLabel?.trim() || "AI review run",
        startedAt: Date.parse(run.startedAt ?? run.createdAt) || Date.now(),
        endedAt: run.endedAt ? Date.parse(run.endedAt) || Date.now() : null,
        model: run.model,
        diffTruncated: run.diffTruncated,
        error: run.error,
        progressEvents: run.progressEvents,
        chunks: run.chunks,
        findings: run.findings,
      }))
    );
    const hasActiveRun = runs.some((run) => run.status === "queued" || run.status === "running");
    setAiReviewBusy(hasActiveRun);
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACCOUNT_EMAIL_MASK_STORAGE_KEY, maskAccountEmail() ? "1" : "0");
  });
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY,
      reviewSidebarCollapsed() ? "1" : "0"
    );
  });
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REPO_REVIEW_DEFAULTS_STORAGE_KEY,
      JSON.stringify(reviewDefaultsByRepo())
    );
  });
  createEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "b" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey
      ) {
        event.preventDefault();
        setReviewSidebarCollapsed((collapsed) => !collapsed);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const getBranchSearchInputRef = () => branchSearchInputRef;
  const getBranchCreateInputRef = () => branchCreateInputRef;

  useAppEffects({
    selectedDiffTheme,
    knownRepoWorkspaces,
    setKnownRepoWorkspaces,
    repoDisplayNames,
    repoGroups,
    selectedThreadId,
    setSelectedThreadId,
    setCompareError,
    setCompareResult,
    setShowDiffViewer,
    setBranchPopoverOpen,
    setBranchSearchQuery,
    setBranchCreateMode,
    setNewBranchName,
    setBranchActionError,
    setAiPrompt,
    setAiFollowUpBusy,
    setAiReviewError,
    setAiStatus,
    setAiChunkReviews,
    setAiFindings,
    setAiProgressEvents,
    branchPopoverOpen,
    selectedWorkspace,
    refetchWorkspaceBranches,
    getBranchSearchInputRef,
    branchCreateMode,
    getBranchCreateInputRef,
    aiReviewConfig,
    setAiReviewProviderInput,
    setAiReviewModelInput,
    setAiOpencodeProviderInput,
    setAiOpencodeModelInput,
    setAiReviewBusy,
    refetchThreadMessages,
    refetchAiReviewRuns,
    aiReviewBusy,
    setAiRunElapsedSeconds,
    setActiveReviewScope,
    setReviewRuns,
    selectedRunId,
    setSelectedRunId,
    setReviewWorkbenchTab,
  });

  const {
    openSettings,
    closeSettings,
    openDeviceVerificationUrl,
    handleStartDeviceAuth,
    handleConnectProvider,
    handleDisconnectProvider,
    handleCloneRepository,
    handlePickDestinationRoot,
    handlePickLocalProject,
    handleCreateLocalProjectThread,
    handleAddLocalRepoFromSidebar,
    isRepoCollapsed,
    repoDisplayName,
    isRepoMenuOpen,
    toggleRepoCollapsed,
    setRepoMenuOpenState,
    handleCreateReviewForRepo,
    handleRenameRepo,
    handleRemoveRepo,
    handleRemoveReview,
    handleOpenDiffsDocs,
    handleSaveAiSettings,
    handleSwitchAppServerAccount,
    handleRefreshAppServerAccountStatus,
    handleSaveAiApiKey,
  } = useProviderAndSettingsActions({
    selectedProvider,
    setSelectedProvider,
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
    setActiveView,
    setActiveSettingsTab,
    refetchGithubConnection,
    refetchGitlabConnection,
    refetchThreads,
    setSelectedThreadId,
    selectedBaseRef,
    setSelectedBaseRef,
    reviewDefaultsByRepo,
    setReviewDefaultsByRepo,
    knownRepoWorkspaces,
    setKnownRepoWorkspaces,
    repoDisplayNames,
    setRepoDisplayNames,
    collapsedRepos,
    setCollapsedRepos,
    repoMenuOpen,
    setRepoMenuOpen,
    settingsError,
    setSettingsError,
    aiReviewProviderInput,
    aiReviewModelInput,
    aiOpencodeProviderInput,
    aiOpencodeModelInput,
    aiSettingsBusy,
    setAiSettingsBusy,
    setAiSettingsError,
    setAiSettingsStatus,
    appServerAuthBusy,
    setAppServerAuthBusy,
    setAppServerAuthError,
    setAppServerAuthStatus,
    aiApiKeyInput,
    setAiApiKeyInput,
    aiApiKeyBusy,
    setAiApiKeyBusy,
    setAiApiKeyError,
    setAiApiKeyStatus,
    refetchAiReviewConfig,
    refetchAppServerAccountStatus,
    refetchOpencodeSidecarStatus,
  });

  const {
    handleCheckoutBranch,
    handleStartCreateBranch,
    handleCreateAndCheckoutBranch,
    handleStartAiReviewOnFullDiff,
    handleCancelAiReviewRun,
    handleAskAiFollowUp,
  } = useReviewActions({
    selectedThreadId,
    selectedWorkspace,
    selectedBaseRef,
    setSelectedBaseRef,
    compareResult,
    setCompareResult,
    setCompareBusy,
    setCompareError,
    setShowDiffViewer,
    setBranchPopoverOpen,
    setBranchCreateMode,
    branchSearchQuery,
    newBranchName,
    setNewBranchName,
    setBranchActionBusy,
    setBranchActionError,
    refetchWorkspaceBranches,
    aiPrompt,
    setAiPrompt,
    setAiReviewBusy,
    setAiFollowUpBusy,
    setAiReviewError,
    setAiStatus,
    setAiChunkReviews,
    setAiFindings,
    setAiProgressEvents,
    refetchThreadMessages,
    refetchAiReviewRuns,
    activeReviewScope,
    setActiveReviewScope,
    setReviewRuns,
    setSelectedRunId,
    setReviewWorkbenchTab,
  });

  const setBranchSearchInputRef = (element: HTMLInputElement | undefined) => {
    branchSearchInputRef = element;
  };

  const setBranchCreateInputRef = (element: HTMLInputElement | undefined) => {
    branchCreateInputRef = element;
  };

  return (
    <SidebarProvider
      defaultOpen
      style={{
        "--sidebar-width": "18rem",
        "--sidebar-width-icon": "3.25rem",
      }}
      class="min-h-svh"
    >
      <Show
        when={activeView() === "workspace"}
        fallback={
          <SettingsView
            activeSettingsTab={activeSettingsTab}
            setActiveSettingsTab={setActiveSettingsTab}
            closeSettings={closeSettings}
            selectedDiffThemeId={selectedDiffThemeId}
            setSelectedDiffThemeId={setSelectedDiffThemeId}
            selectedDiffTheme={selectedDiffTheme}
            settingsError={settingsError}
            handleOpenDiffsDocs={handleOpenDiffsDocs}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            selectedProviderOption={selectedProviderOption}
            selectedProviderConnection={selectedProviderConnection}
            providerBusy={providerBusy}
            providerToken={providerToken}
            setProviderToken={setProviderToken}
            providerConnectionError={providerConnectionError}
            providerError={providerError}
            providerStatus={providerStatus}
            deviceAuthInProgress={deviceAuthInProgress}
            deviceAuthUserCode={deviceAuthUserCode}
            openDeviceVerificationUrl={openDeviceVerificationUrl}
            handleStartDeviceAuth={handleStartDeviceAuth}
            handleConnectProvider={handleConnectProvider}
            handleDisconnectProvider={handleDisconnectProvider}
            handleCloneRepository={handleCloneRepository}
            repositoryInput={repositoryInput}
            setRepositoryInput={setRepositoryInput}
            destinationRoot={destinationRoot}
            setDestinationRoot={setDestinationRoot}
            localProjectPath={localProjectPath}
            setLocalProjectPath={setLocalProjectPath}
            handlePickDestinationRoot={handlePickDestinationRoot}
            handlePickLocalProject={handlePickLocalProject}
            handleCreateLocalProjectThread={handleCreateLocalProjectThread}
            aiReviewConfig={aiReviewConfig}
            aiReviewProviderInput={aiReviewProviderInput}
            setAiReviewProviderInput={setAiReviewProviderInput}
            aiReviewModelInput={aiReviewModelInput}
            setAiReviewModelInput={setAiReviewModelInput}
            aiOpencodeProviderInput={aiOpencodeProviderInput}
            setAiOpencodeProviderInput={setAiOpencodeProviderInput}
            aiOpencodeModelInput={aiOpencodeModelInput}
            setAiOpencodeModelInput={setAiOpencodeModelInput}
            aiSettingsBusy={aiSettingsBusy}
            aiSettingsError={aiSettingsError}
            aiSettingsStatus={aiSettingsStatus}
            aiReviewConfigLoadError={aiReviewConfigLoadError}
            handleSaveAiSettings={handleSaveAiSettings}
            appServerAccountStatus={appServerAccountStatus}
            appServerAccountLoadError={appServerAccountLoadError}
            appServerAuthBusy={appServerAuthBusy}
            appServerAuthError={appServerAuthError}
            appServerAuthStatus={appServerAuthStatus}
            handleSwitchAppServerAccount={handleSwitchAppServerAccount}
            handleRefreshAppServerAccountStatus={handleRefreshAppServerAccountStatus}
            maskAccountEmail={maskAccountEmail}
            setMaskAccountEmail={setMaskAccountEmail}
            opencodeSidecarStatus={opencodeSidecarStatus}
            opencodeSidecarLoadError={opencodeSidecarLoadError}
            aiApiKeyInput={aiApiKeyInput}
            setAiApiKeyInput={setAiApiKeyInput}
            aiApiKeyBusy={aiApiKeyBusy}
            aiApiKeyError={aiApiKeyError}
            aiApiKeyStatus={aiApiKeyStatus}
            handleSaveAiApiKey={handleSaveAiApiKey}
          />
        }
      >
        <WorkspaceRepoSidebar
          providerBusy={providerBusy}
          onAddLocalRepo={handleAddLocalRepoFromSidebar}
          threadsLoading={() => threads.loading}
          repoGroups={repoGroups}
          loadError={loadError}
          repoDisplayName={repoDisplayName}
          isRepoCollapsed={isRepoCollapsed}
          toggleRepoCollapsed={toggleRepoCollapsed}
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
          onCreateReviewForRepo={handleCreateReviewForRepo}
          selectedBaseRef={selectedBaseRef}
          reviewDefaultsByRepo={reviewDefaultsByRepo}
          isRepoMenuOpen={isRepoMenuOpen}
          setRepoMenuOpenState={setRepoMenuOpenState}
          onRenameRepo={handleRenameRepo}
          onRemoveRepo={handleRemoveRepo}
          onRemoveReview={handleRemoveReview}
          onOpenSettings={() => openSettings("connections")}
          onSwitchAccount={handleSwitchAppServerAccount}
          appServerAccountStatus={appServerAccountStatus}
          appServerAccountLoadError={appServerAccountLoadError}
          maskAccountEmail={maskAccountEmail}
        />

        <SidebarInset class="bg-transparent p-2 md:p-3">
          <section class="glass-surface flex h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <WorkspaceHeader
              selectedReview={selectedReview}
              repoDisplayName={repoDisplayName}
              compareResult={compareResult}
              selectedBaseRef={selectedBaseRef}
              reviewSidebarCollapsed={reviewSidebarCollapsed}
              toggleReviewSidebar={() =>
                setReviewSidebarCollapsed((collapsed) => !collapsed)
              }
            />
            <WorkspaceMainPane
              branchActionError={branchActionError}
              compareError={compareError}
              aiReviewError={aiReviewError}
              aiStatus={aiStatus}
              aiReviewBusy={aiReviewBusy}
              aiRunElapsedSeconds={aiRunElapsedSeconds}
              compareSummary={compareSummary}
              compareBusy={compareBusy}
              selectedWorkspace={selectedWorkspace}
              compareResult={compareResult}
              showDiffViewer={showDiffViewer}
              activeReviewScope={activeReviewScope}
              setActiveReviewScope={setActiveReviewScope}
              selectedDiffTheme={selectedDiffTheme}
              diffAnnotations={diffAnnotations}
              handleStartAiReviewOnFullDiff={handleStartAiReviewOnFullDiff}
            />
          </section>
        </SidebarInset>
        <WorkspaceReviewSidebar
          reviewSidebarCollapsed={reviewSidebarCollapsed}
          activeReviewScope={activeReviewScope}
          setActiveReviewScope={setActiveReviewScope}
          aiChunkReviews={aiChunkReviews}
          aiFindings={aiFindings}
          aiProgressEvents={aiProgressEvents}
          reviewRuns={reviewRuns}
          selectedRunId={selectedRunId}
          setSelectedRunId={setSelectedRunId}
          reviewWorkbenchTab={reviewWorkbenchTab}
          setReviewWorkbenchTab={setReviewWorkbenchTab}
          threadMessagesLoadError={threadMessagesLoadError}
          threadMessages={threadMessages}
          aiPrompt={aiPrompt}
          setAiPrompt={setAiPrompt}
          handleAskAiFollowUp={handleAskAiFollowUp}
          handleCancelAiReviewRun={handleCancelAiReviewRun}
          aiReviewBusy={aiReviewBusy}
          aiFollowUpBusy={aiFollowUpBusy}
          compareBusy={compareBusy}
          selectedWorkspace={selectedWorkspace}
          branchPopoverOpen={branchPopoverOpen}
          setBranchPopoverOpen={setBranchPopoverOpen}
          workspaceBranches={workspaceBranches}
          workspaceBranchesLoading={() => workspaceBranches.loading}
          currentWorkspaceBranch={currentWorkspaceBranch}
          branchSearchQuery={branchSearchQuery}
          setBranchSearchQuery={setBranchSearchQuery}
          filteredWorkspaceBranches={filteredWorkspaceBranches}
          branchActionBusy={branchActionBusy}
          handleCheckoutBranch={handleCheckoutBranch}
          workspaceBranchLoadError={workspaceBranchLoadError}
          branchCreateMode={branchCreateMode}
          handleCreateAndCheckoutBranch={handleCreateAndCheckoutBranch}
          setBranchSearchInputRef={setBranchSearchInputRef}
          setBranchCreateInputRef={setBranchCreateInputRef}
          newBranchName={newBranchName}
          setNewBranchName={setNewBranchName}
          setBranchCreateMode={setBranchCreateMode}
          canCreateBranch={canCreateBranch}
          handleStartCreateBranch={handleStartCreateBranch}
        />
      </Show>
    </SidebarProvider>
  );
}

export default App;
