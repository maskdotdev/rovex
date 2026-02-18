import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
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
  repoNameFromWorkspace,
  sleep,
} from "@/app/helpers";
import { SettingsView } from "@/app/components/settings-view";
import { WorkspaceHeader } from "@/app/components/workspace-header";
import { WorkspaceMainPane } from "@/app/components/workspace-main-pane";
import { WorkspaceRepoSidebar } from "@/app/components/workspace-repo-sidebar";
import type { AppView, RepoGroup, RepoReview, SettingsTab } from "@/app/types";
import {
  checkoutWorkspaceBranch,
  compareWorkspaceDiff,
  cloneRepository,
  connectProvider,
  createWorkspaceBranch,
  createThread,
  deleteThread,
  disconnectProvider,
  generateAiFollowUp,
  generateAiReview,
  getAiReviewConfig,
  getOpencodeSidecarStatus,
  getProviderConnection,
  listThreadMessages,
  listWorkspaceBranches,
  listThreads,
  pollProviderDeviceAuth,
  setAiReviewApiKey,
  setAiReviewSettings,
  startProviderDeviceAuth,
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
  type StartProviderDeviceAuthResult,
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
  let deviceAuthSession = 0;

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

  const clearProviderNotice = () => {
    setProviderError(null);
    setProviderStatus(null);
  };

  const refetchProviderConnection = async (provider: ProviderKind) => {
    if (provider === "github") {
      await refetchGithubConnection();
      return;
    }
    await refetchGitlabConnection();
  };

  const cancelDeviceAuthFlow = () => {
    deviceAuthSession += 1;
    setDeviceAuthInProgress(false);
    setDeviceAuthUserCode(null);
    setDeviceAuthVerificationUrl(null);
  };

  onCleanup(() => {
    cancelDeviceAuthFlow();
  });

  createEffect(() => {
    selectedProvider();
    clearProviderNotice();
    cancelDeviceAuthFlow();
    setProviderToken("");
    setRepositoryInput("");
  });

  const openDeviceVerificationUrl = async (providerLabel: string) => {
    const url = deviceAuthVerificationUrl();
    if (!url) return;

    try {
      await openUrl(url);
    } catch (error) {
      setProviderError(
        error instanceof Error
          ? error.message
          : `Failed to open ${providerLabel} verification URL.`
      );
    }
  };

  const pollProviderDeviceAuthFlow = async (
    sessionId: number,
    provider: ProviderKind,
    flow: StartProviderDeviceAuthResult
  ) => {
    const label = providerOption(provider).label;
    let intervalMs = Math.max(1, flow.interval) * 1000;
    const expiresAt = Date.now() + Math.max(1, flow.expiresIn) * 1000;

    while (sessionId === deviceAuthSession && Date.now() < expiresAt) {
      await sleep(intervalMs);
      if (sessionId !== deviceAuthSession) {
        return;
      }

      try {
        const result = await pollProviderDeviceAuth({
          provider,
          deviceCode: flow.deviceCode,
        });
        if (sessionId !== deviceAuthSession) {
          return;
        }

        if (result.status === "complete" && result.connection) {
          await refetchProviderConnection(provider);
          cancelDeviceAuthFlow();
          setProviderStatus(`Connected ${label} as ${result.connection.accountLogin}.`);
          return;
        }

        if (result.status === "slow_down") {
          intervalMs += 5000;
        }
      } catch (error) {
        if (sessionId !== deviceAuthSession) {
          return;
        }
        cancelDeviceAuthFlow();
        setProviderError(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (sessionId !== deviceAuthSession) {
      return;
    }
    cancelDeviceAuthFlow();
    setProviderError(`${label} sign-in timed out. Start again.`);
  };

  const handleStartDeviceAuth = async () => {
    const provider = selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    const sessionId = deviceAuthSession;

    setProviderBusy(true);
    try {
      const flow = await startProviderDeviceAuth({ provider });
      const verificationUrl = flow.verificationUriComplete ?? flow.verificationUri;

      setDeviceAuthInProgress(true);
      setDeviceAuthUserCode(flow.userCode);
      setDeviceAuthVerificationUrl(verificationUrl);
      setProviderStatus(`Enter code ${flow.userCode} in ${selected.label} to finish connecting.`);

      await openDeviceVerificationUrl(selected.label);
      void pollProviderDeviceAuthFlow(sessionId, provider, flow);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
      cancelDeviceAuthFlow();
    } finally {
      setProviderBusy(false);
    }
  };

  const openSettings = (tab: SettingsTab = "connections") => {
    setActiveSettingsTab(tab);
    setActiveView("settings");
  };

  const closeSettings = () => {
    setActiveView("workspace");
  };

  const handleConnectProvider = async (event: Event) => {
    const provider = selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();
    cancelDeviceAuthFlow();

    const token = providerToken().trim();
    if (!token) {
      setProviderError(`Enter a ${selected.label} personal access token.`);
      return;
    }

    setProviderBusy(true);
    try {
      const connection = await connectProvider({ provider, accessToken: token });
      setProviderToken("");
      await refetchProviderConnection(provider);
      setProviderStatus(`Connected ${selected.label} as ${connection.accountLogin}.`);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleDisconnectProvider = async () => {
    const provider = selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    setProviderBusy(true);
    try {
      await disconnectProvider(provider);
      await refetchProviderConnection(provider);
      setProviderStatus(`Disconnected ${selected.label}.`);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleCloneRepository = async (event: Event) => {
    const provider = selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();

    const repository = repositoryInput().trim();
    if (!repository) {
      setProviderError(`Enter a ${selected.label} repository path or URL.`);
      return;
    }

    setProviderBusy(true);
    try {
      const cloneResult = await cloneRepository({
        provider,
        repository,
        destinationRoot: destinationRoot().trim() || null,
        shallow: true,
      });

      await createThread({
        title: `Review ${cloneResult.repository}`,
        workspace: cloneResult.workspace,
      });
      await refetchThreads();

      setRepositoryInput("");
      setProviderStatus(
        `Cloned ${cloneResult.repository} to ${cloneResult.workspace} and created a review thread.`
      );
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const pickDirectory = async (defaultPath?: string): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultPath?.trim() || undefined,
      });
      return typeof selected === "string" ? selected : null;
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const handlePickDestinationRoot = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(destinationRoot());
    if (!selectedPath) return;
    setDestinationRoot(selectedPath);
  };

  const handlePickLocalProject = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(localProjectPath());
    if (!selectedPath) return;
    setLocalProjectPath(selectedPath);
  };

  const handleCreateLocalProjectThread = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

    const workspace = localProjectPath().trim();
    if (!workspace) {
      setProviderError("Select a local project directory.");
      return;
    }

    setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(workspace)}`,
        workspace,
      });
      await refetchThreads();
      setSelectedThreadId(thread.id);
      setLocalProjectPath("");
      setProviderStatus(`Added local project ${workspace} and created a review thread.`);
      setActiveView("workspace");
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleAddLocalRepoFromSidebar = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory();
    if (!selectedPath) return;

    setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(selectedPath)}`,
        workspace: selectedPath,
      });
      await refetchThreads();
      setSelectedThreadId(thread.id);
      setProviderStatus(`Added local project ${selectedPath} and created a review thread.`);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const isRepoCollapsed = (repoName: string) => collapsedRepos()[repoName] ?? false;
  const repoDisplayName = (repoName: string) => repoDisplayNames()[repoName] ?? repoName;
  const isRepoMenuOpen = (repoName: string) => repoMenuOpen()[repoName] ?? false;

  const toggleRepoCollapsed = (repoName: string) => {
    setCollapsedRepos((current) => ({
      ...current,
      [repoName]: !(current[repoName] ?? false),
    }));
  };

  const setRepoMenuOpenState = (repoName: string, open: boolean) => {
    setRepoMenuOpen((current) => ({
      ...current,
      [repoName]: open,
    }));
  };

  const handleCreateReviewForRepo = async (repo: RepoGroup) => {
    clearProviderNotice();
    const workspace = repo.reviews.find((review) => review.workspace?.trim())?.workspace?.trim();
    if (!workspace) {
      setProviderError(`No local workspace found for ${repo.repoName}.`);
      return;
    }

    setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoDisplayName(repo.repoName)}`,
        workspace,
      });
      await refetchThreads();
      setSelectedThreadId(thread.id);
      setCollapsedRepos((current) => ({ ...current, [repo.repoName]: false }));
      setProviderStatus(`Created a new review for ${repoDisplayName(repo.repoName)}.`);
      setRepoMenuOpenState(repo.repoName, false);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleRenameRepo = (repo: RepoGroup) => {
    const existingName = repoDisplayName(repo.repoName);
    const nextName = window.prompt("Edit repository name", existingName)?.trim();
    if (!nextName) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    setRepoDisplayNames((current) => {
      const next = { ...current };
      if (nextName === repo.repoName) {
        delete next[repo.repoName];
      } else {
        next[repo.repoName] = nextName;
      }
      return next;
    });
    setProviderStatus(`Renamed ${repo.repoName} to ${nextName}.`);
    setRepoMenuOpenState(repo.repoName, false);
  };

  const handleRemoveRepo = async (repo: RepoGroup) => {
    const displayName = repoDisplayName(repo.repoName);
    const reviewCount = repo.reviews.length;
    const confirmed = window.confirm(
      `Remove ${displayName} and ${reviewCount} review${reviewCount === 1 ? "" : "s"} from Rovex? Local files are not deleted.`
    );
    if (!confirmed) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    clearProviderNotice();
    setProviderBusy(true);
    try {
      for (const review of repo.reviews) {
        await deleteThread(review.id);
      }
      await refetchThreads();
      setRepoDisplayNames((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      setCollapsedRepos((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      setProviderStatus(
        `Removed ${displayName} with ${reviewCount} review${reviewCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
      setRepoMenuOpenState(repo.repoName, false);
    }
  };

  const handleOpenDiffsDocs = async () => {
    setSettingsError(null);
    try {
      await openUrl("https://diffs.com/");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearAiApiKeyNotice = () => {
    setAiApiKeyError(null);
    setAiApiKeyStatus(null);
  };

  const clearAiSettingsNotice = () => {
    setAiSettingsError(null);
    setAiSettingsStatus(null);
  };

  const handleSaveAiSettings = async (event: Event) => {
    event.preventDefault();
    clearAiSettingsNotice();

    const provider = aiReviewProviderInput().trim().toLowerCase();
    const model = aiReviewModelInput().trim();
    const opencodeProvider = aiOpencodeProviderInput().trim();
    const opencodeModel = aiOpencodeModelInput().trim();

    if (provider !== "openai" && provider !== "opencode") {
      setAiSettingsError("Provider must be openai or opencode.");
      return;
    }
    if (!model) {
      setAiSettingsError("Enter a review model.");
      return;
    }

    setAiSettingsBusy(true);
    try {
      await setAiReviewSettings({
        reviewProvider: provider,
        reviewModel: model,
        opencodeProvider: opencodeProvider || "openai",
        opencodeModel: opencodeModel || null,
        persistToEnv: true,
      });
      await refetchAiReviewConfig();
      if (provider === "opencode") {
        await refetchOpencodeSidecarStatus();
      }
      setAiSettingsStatus(
        provider === "opencode"
          ? "Saved AI review settings for bundled OpenCode provider."
          : "Saved AI review settings."
      );
    } catch (error) {
      setAiSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiSettingsBusy(false);
    }
  };

  const handleSaveAiApiKey = async (event: Event) => {
    event.preventDefault();
    clearAiApiKeyNotice();

    const apiKey = aiApiKeyInput().trim();
    if (!apiKey) {
      setAiApiKeyError("Enter an API key.");
      return;
    }

    setAiApiKeyBusy(true);
    try {
      const config = await setAiReviewApiKey({
        apiKey,
        persistToEnv: true,
      });
      setAiApiKeyInput("");
      await refetchAiReviewConfig();
      setAiApiKeyStatus(
        config.envFilePath
          ? `Saved OPENAI_API_KEY to ${config.envFilePath}.`
          : "Saved OPENAI_API_KEY."
      );
    } catch (error) {
      setAiApiKeyError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiApiKeyBusy(false);
    }
  };

  const resetComparisonView = () => {
    setCompareError(null);
    setCompareResult(null);
    setShowDiffViewer(false);
  };

  const handleCheckoutBranch = async (branchName: string) => {
    const workspace = selectedWorkspace().trim();
    const normalizedBranchName = branchName.trim();
    if (!workspace) {
      setBranchActionError("Select a review with a local workspace before switching branches.");
      return;
    }
    if (!normalizedBranchName) return;

    setBranchActionBusy(true);
    setBranchActionError(null);
    try {
      await checkoutWorkspaceBranch({
        workspace,
        branchName: normalizedBranchName,
      });
      await refetchWorkspaceBranches();
      setBranchPopoverOpen(false);
      setBranchCreateMode(false);
      setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchActionBusy(false);
    }
  };

  const handleStartCreateBranch = () => {
    setBranchCreateMode(true);
    setNewBranchName(branchSearchQuery().trim());
  };

  const handleCreateAndCheckoutBranch = async (event: Event) => {
    event.preventDefault();
    const workspace = selectedWorkspace().trim();
    const branchName = newBranchName().trim();
    if (!workspace) {
      setBranchActionError("Select a review with a local workspace before creating a branch.");
      return;
    }
    if (!branchName) {
      setBranchActionError("Branch name must not be empty.");
      return;
    }

    setBranchActionBusy(true);
    setBranchActionError(null);
    try {
      await createWorkspaceBranch({
        workspace,
        branchName,
      });
      await refetchWorkspaceBranches();
      setBranchPopoverOpen(false);
      setBranchCreateMode(false);
      setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchActionBusy(false);
    }
  };

  const handleCompareSelectedReview = async (target: { baseRef?: string; fetchRemote?: boolean } = {}) => {
    const baseRef = target.baseRef?.trim() || selectedBaseRef().trim() || "main";
    const fetchRemote = target.fetchRemote ?? false;
    setCompareError(null);

    const workspace = selectedWorkspace();
    if (!workspace) {
      setCompareError("Select a review that has a local workspace path.");
      return;
    }

    setCompareBusy(true);
    try {
      const result = await compareWorkspaceDiff({
        workspace,
        baseRef,
        fetchRemote,
      });
      setSelectedBaseRef(result.baseRef);
      setCompareResult(result);
      setShowDiffViewer(true);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompareBusy(false);
    }
  };

  const handleOpenDiffViewer = async () => {
    if (compareResult()) {
      setShowDiffViewer((current) => !current);
      return;
    }

    await handleCompareSelectedReview();
  };

  const handleStartAiReview = async () => {
    setAiReviewError(null);
    setAiStatus(null);
    setAiChunkReviews([]);
    setAiFindings([]);
    setAiProgressEvents([]);

    const threadId = selectedThreadId();
    if (threadId == null) {
      setAiReviewError("Select a review before running AI.");
      return;
    }

    let comparison = compareResult();
    if (!comparison) {
      await handleCompareSelectedReview();
      comparison = compareResult();
    }

    if (!comparison) {
      setAiReviewError("Load a diff before running AI review.");
      return;
    }

    setAiReviewBusy(true);
    setAiStatus("Starting chunked review...");
    try {
      const response = await generateAiReview({
        threadId,
        workspace: comparison.workspace,
        baseRef: comparison.baseRef,
        mergeBase: comparison.mergeBase,
        head: comparison.head,
        filesChanged: comparison.filesChanged,
        insertions: comparison.insertions,
        deletions: comparison.deletions,
        diff: comparison.diff,
        prompt: aiPrompt().trim() || null,
      });
      await refetchThreadMessages();
      setAiPrompt("");
      setAiChunkReviews(response.chunks);
      setAiFindings(response.findings);
      setAiStatus(
        `Reviewed ${response.chunks.length} chunk(s) with ${response.findings.length} finding(s) using ${response.model}${response.diffTruncated ? " (truncated chunk input)." : "."}`
      );
    } catch (error) {
      setAiReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiReviewBusy(false);
    }
  };

  const handleAskAiFollowUp = async (event: Event) => {
    event.preventDefault();
    setAiReviewError(null);
    setAiStatus(null);

    const threadId = selectedThreadId();
    if (threadId == null) {
      setAiReviewError("Select a review before asking questions.");
      return;
    }
    if (!hasReviewStarted()) {
      setAiReviewError("Start review before asking follow-up questions.");
      return;
    }

    const workspace = selectedWorkspace().trim();
    if (!workspace) {
      setAiReviewError("Select a review that has a local workspace path.");
      return;
    }

    const question = aiPrompt().trim();
    if (!question) {
      setAiReviewError("Type a follow-up question.");
      return;
    }

    setAiReviewBusy(true);
    setAiStatus("Sending follow-up question...");
    try {
      const response = await generateAiFollowUp({
        threadId,
        workspace,
        question,
      });
      await refetchThreadMessages();
      setAiPrompt("");
      setAiStatus(`Answered with ${response.model}.`);
    } catch (error) {
      setAiReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiReviewBusy(false);
    }
  };

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
