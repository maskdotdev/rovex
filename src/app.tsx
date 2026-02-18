import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { listen } from "@tauri-apps/api/event";
import type { DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/sidebar";
import {
  DIFF_THEME_STORAGE_KEY,
  REPO_DISPLAY_NAME_STORAGE_KEY,
} from "@/app/constants";
import {
  getDiffThemePreset,
  getInitialDiffThemeId,
  getInitialRepoDisplayNames,
  groupThreadsByRepo,
  providerOption,
} from "@/app/helpers";
import { SettingsView } from "@/app/components/settings-view";
import { WorkspaceHeader } from "@/app/components/workspace-header";
import { WorkspaceMainPane } from "@/app/components/workspace-main-pane";
import { WorkspaceRepoSidebar } from "@/app/components/workspace-repo-sidebar";
import { useProviderAndSettingsActions } from "@/app/hooks/use-provider-and-settings-actions";
import { useReviewActions } from "@/app/hooks/use-review-actions";
import type { AppView, RepoReview, SettingsTab } from "@/app/types";
import {
  getAiReviewConfig,
  getOpencodeSidecarStatus,
  getProviderConnection,
  listThreadMessages,
  listWorkspaceBranches,
  listThreads,
  type AiReviewChunk,
  type AiReviewConfig,
  type AiReviewFinding,
  type AiReviewProgressEvent,
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
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderKind>("github");
  const selectedDiffTheme = createMemo(() => getDiffThemePreset(selectedDiffThemeId()));
  const selectedProviderOption = createMemo(() => providerOption(selectedProvider()));
  const selectedProviderConnection = createMemo(() =>
    selectedProvider() === "github" ? githubConnection() : gitlabConnection()
  );

  const repoGroups = createMemo(() => groupThreadsByRepo(threads() ?? []));
  const [collapsedRepos, setCollapsedRepos] = createSignal<Record<string, boolean>>({});
  const [repoDisplayNames, setRepoDisplayNames] = createSignal<Record<string, string>>(
    getInitialRepoDisplayNames()
  );
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
  const [selectedBaseRef, setSelectedBaseRef] = createSignal("main");
  const [branchPopoverOpen, setBranchPopoverOpen] = createSignal(false);
  const [branchSearchQuery, setBranchSearchQuery] = createSignal("");
  const [branchCreateMode, setBranchCreateMode] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal("");
  const [branchActionBusy, setBranchActionBusy] = createSignal(false);
  const [branchActionError, setBranchActionError] = createSignal<string | null>(null);
  const [aiPrompt, setAiPrompt] = createSignal("");
  const [aiReviewBusy, setAiReviewBusy] = createSignal(false);
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
  const [aiChunkReviews, setAiChunkReviews] = createSignal<AiReviewChunk[]>([]);
  const [aiFindings, setAiFindings] = createSignal<AiReviewFinding[]>([]);
  const [aiProgressEvents, setAiProgressEvents] = createSignal<AiReviewProgressEvent[]>([]);
  let branchSearchInputRef: HTMLInputElement | undefined;
  let branchCreateInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DIFF_THEME_STORAGE_KEY, selectedDiffTheme().id);
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REPO_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(repoDisplayNames()));
  });

  createEffect(() => {
    const groups = repoGroups();
    if (groups.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    const selected = selectedThreadId();
    const hasSelected = groups.some((group) => group.reviews.some((review) => review.id === selected));
    if (hasSelected) return;

    setSelectedThreadId(groups[0].reviews[0]?.id ?? null);
  });

  const selectedReview = createMemo<RepoReview | undefined>(() => {
    const selected = selectedThreadId();
    if (selected == null) return undefined;

    for (const group of repoGroups()) {
      const review = group.reviews.find((candidate) => candidate.id === selected);
      if (review) return review;
    }

    return undefined;
  });

  createEffect(() => {
    selectedThreadId();
    setCompareError(null);
    setCompareResult(null);
    setShowDiffViewer(false);
    setBranchPopoverOpen(false);
    setBranchSearchQuery("");
    setBranchCreateMode(false);
    setNewBranchName("");
    setBranchActionError(null);
    setAiPrompt("");
    setAiReviewError(null);
    setAiStatus(null);
    setAiChunkReviews([]);
    setAiFindings([]);
    setAiProgressEvents([]);
  });

  createEffect(() => {
    if (!branchPopoverOpen()) return;
    setBranchSearchQuery("");
    setBranchCreateMode(false);
    setNewBranchName("");
    setBranchActionError(null);
    if (selectedWorkspace().length > 0) {
      void refetchWorkspaceBranches();
    }
    queueMicrotask(() => {
      branchSearchInputRef?.focus();
    });
  });

  createEffect(() => {
    if (!branchCreateMode()) return;
    queueMicrotask(() => {
      branchCreateInputRef?.focus();
    });
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
  const [aiReviewConfig, { refetch: refetchAiReviewConfig }] = createResource<AiReviewConfig>(
    () => getAiReviewConfig()
  );
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
  createEffect(() => {
    const config = aiReviewConfig();
    if (!config) return;
    setAiReviewProviderInput(config.reviewProvider || "openai");
    setAiReviewModelInput(config.reviewModel || "gpt-4.1-mini");
    setAiOpencodeProviderInput(config.opencodeProvider || "openai");
    setAiOpencodeModelInput(config.opencodeModel ?? "");
  });
  const hasReviewStarted = createMemo(() =>
    (threadMessages() ?? []).some((message) => message.role === "assistant")
  );

  createEffect(() => {
    let active = true;
    let stopListening: (() => void) | null = null;

    void listen<AiReviewProgressEvent>("rovex://ai-review-progress", (event) => {
      if (!active) return;
      const payload = event.payload;
      const selected = selectedThreadId();
      if (selected != null && payload.threadId !== selected) return;

      setAiProgressEvents((current) => {
        const next = [...current, payload];
        return next.length > 160 ? next.slice(next.length - 160) : next;
      });

      if (payload.status === "started") {
        setAiReviewBusy(true);
        setAiReviewError(null);
        setAiStatus(payload.message);
        setAiChunkReviews([]);
        setAiFindings([]);
      } else if (payload.status === "failed") {
        setAiReviewBusy(false);
        setAiReviewError(payload.message);
      } else {
        setAiStatus(payload.message);
      }

      const chunk = payload.chunk;
      if (chunk) {
        setAiChunkReviews((current) => {
          const next = [...current];
          const existingIndex = next.findIndex((candidate) => candidate.id === chunk.id);
          if (existingIndex >= 0) {
            next[existingIndex] = chunk;
          } else {
            next.push(chunk);
          }
          return next.sort((left, right) =>
            left.filePath.localeCompare(right.filePath) || left.chunkIndex - right.chunkIndex
          );
        });
      }

      const finding = payload.finding;
      if (finding) {
        setAiFindings((current) => {
          if (current.some((candidate) => candidate.id === finding.id)) {
            return current;
          }
          return [...current, finding];
        });
      }

      if (payload.status === "completed") {
        setAiReviewBusy(false);
        void refetchThreadMessages();
      }
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      stopListening = unlisten;
    });

    onCleanup(() => {
      active = false;
      stopListening?.();
    });
  });

  createEffect(() => {
    if (!aiReviewBusy()) {
      setAiRunElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setAiRunElapsedSeconds(0);
    void refetchThreadMessages();

    const interval = window.setInterval(() => {
      setAiRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      void refetchThreadMessages();
    }, 1200);

    onCleanup(() => {
      window.clearInterval(interval);
    });
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
    handleOpenDiffsDocs,
    handleSaveAiSettings,
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
    aiApiKeyInput,
    setAiApiKeyInput,
    aiApiKeyBusy,
    setAiApiKeyBusy,
    setAiApiKeyError,
    setAiApiKeyStatus,
    refetchAiReviewConfig,
    refetchOpencodeSidecarStatus,
  });

  const {
    handleCheckoutBranch,
    handleStartCreateBranch,
    handleCreateAndCheckoutBranch,
    handleOpenDiffViewer,
    handleStartAiReview,
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
    hasReviewStarted,
    setAiReviewBusy,
    setAiReviewError,
    setAiStatus,
    setAiChunkReviews,
    setAiFindings,
    setAiProgressEvents,
    refetchThreadMessages,
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
          isRepoMenuOpen={isRepoMenuOpen}
          setRepoMenuOpenState={setRepoMenuOpenState}
          onRenameRepo={handleRenameRepo}
          onRemoveRepo={handleRemoveRepo}
          onOpenSettings={() => openSettings("connections")}
        />

        <SidebarInset class="bg-transparent p-2 md:p-3">
          <section class="glass-surface flex h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <WorkspaceHeader
              selectedReview={selectedReview}
              repoDisplayName={repoDisplayName}
              compareResult={compareResult}
              selectedBaseRef={selectedBaseRef}
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
              handleStartAiReview={handleStartAiReview}
              hasReviewStarted={hasReviewStarted}
              handleOpenDiffViewer={handleOpenDiffViewer}
              compareResult={compareResult}
              showDiffViewer={showDiffViewer}
              selectedBaseRef={selectedBaseRef}
              selectedDiffTheme={selectedDiffTheme}
              diffAnnotations={diffAnnotations}
              aiChunkReviews={aiChunkReviews}
              aiFindings={aiFindings}
              aiProgressEvents={aiProgressEvents}
              threadMessagesLoadError={threadMessagesLoadError}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              handleAskAiFollowUp={handleAskAiFollowUp}
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
          </section>
        </SidebarInset>
      </Show>
    </SidebarProvider>
  );
}

export default App;
