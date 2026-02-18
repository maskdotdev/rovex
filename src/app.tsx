import {
  For,
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
import {
  Check,
  ChevronRight,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  PlusCircle,
  PlugZap,
  Search,
  Send,
} from "lucide-solid";
import * as Popover from "@kobalte/core/popover";
import { Button } from "@/components/button";
import { DiffViewer, type DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/sidebar";
import { TextField, TextFieldInput } from "@/components/text-field";
import {
  DIFF_THEME_STORAGE_KEY,
  REPO_DISPLAY_NAME_STORAGE_KEY,
  diffThemePresets,
  diffThemePreviewPatch,
  providerOptions,
  settingsNavItems,
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
import { SettingsSidebar } from "@/app/components/settings-sidebar";
import { WorkspaceHeader } from "@/app/components/workspace-header";
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

  const selectedSettingsItem = createMemo(() => {
    const selected = settingsNavItems.find((item) => item.id === activeSettingsTab());
    return selected ?? settingsNavItems[0];
  });

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
          /* ── Settings View ── */
          <div class="h-svh w-full p-2 md:p-3">
            <section class="glass-surface flex h-[calc(100svh-1rem)] overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_20px_50px_rgba(0,0,0,0.4)] md:h-[calc(100svh-1.5rem)]">
              <SettingsSidebar
                activeSettingsTab={activeSettingsTab}
                onSelectTab={setActiveSettingsTab}
                onBack={closeSettings}
              />

              {/* Settings content */}
              <main class="min-h-0 flex-1 overflow-y-auto px-8 py-8 md:px-12 md:py-10">
                <div class="animate-fade-up">
                  <h1 class="app-title text-[clamp(2rem,2.8vw,3rem)] text-neutral-100">
                    {selectedSettingsItem().label}
                  </h1>
                  <p class="mt-2 max-w-lg text-[15px] leading-relaxed text-neutral-500">
                    {selectedSettingsItem().description}
                  </p>
                </div>

                <Show
                  when={activeSettingsTab() === "connections"}
                  fallback={
                    <Show
                      when={activeSettingsTab() === "personalization"}
                      fallback={
                        <Show
                          when={activeSettingsTab() === "environments"}
                          fallback={
                            <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                              <p class="text-[15px] font-medium text-neutral-200">{selectedSettingsItem().label}</p>
                              <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                                This section is ready for settings controls. Select Connections or Environments to configure active integrations.
                              </p>
                            </section>
                          }
                        >
                          <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                            <p class="text-[15px] font-medium text-neutral-200">
                              AI Review Provider
                            </p>
                            <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                              Configure which backend provider and model power reviews. Settings are applied immediately and persisted to <span class="font-mono text-neutral-300">.env</span>.
                            </p>

                            <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                  Active provider
                                </p>
                                <span
                                  class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11.5px] font-medium tracking-wide text-neutral-300"
                                >
                                  {(aiReviewConfig()?.reviewProvider ?? "openai").toUpperCase()}
                                </span>
                              </div>
                              <p class="mt-2 text-[13px] text-neutral-400">
                                Model: <span class="font-mono text-neutral-300">{aiReviewConfig()?.reviewModel ?? "gpt-4.1-mini"}</span>
                              </p>
                              <Show when={aiReviewConfig()?.envFilePath}>
                                {(envPath) => (
                                  <p class="mt-2 text-[12px] leading-relaxed text-neutral-500">
                                    Saved to <span class="font-mono text-neutral-400">{envPath()}</span>
                                  </p>
                                )}
                              </Show>
                            </div>

                            <form class="mt-4 max-w-xl space-y-3" onSubmit={(event) => void handleSaveAiSettings(event)}>
                              <label
                                for="ai-review-provider-select"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                Review provider
                              </label>
                              <select
                                id="ai-review-provider-select"
                                value={aiReviewProviderInput()}
                                onChange={(event) => setAiReviewProviderInput(event.currentTarget.value)}
                                class="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[14px] text-neutral-200 outline-none transition-colors hover:border-white/[0.14] focus:border-amber-500/35"
                              >
                                <option value="openai">openai</option>
                                <option value="opencode">opencode</option>
                              </select>

                              <label
                                for="ai-review-model-input"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                Review model
                              </label>
                              <TextField>
                                <TextFieldInput
                                  id="ai-review-model-input"
                                  type="text"
                                  placeholder="gpt-4.1-mini"
                                  value={aiReviewModelInput()}
                                  onInput={(event) => setAiReviewModelInput(event.currentTarget.value)}
                                  class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                />
                              </TextField>

                              <Show when={aiReviewProviderInput() === "opencode"}>
                                <>
                                  <label
                                    for="opencode-provider-input"
                                    class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                                  >
                                    OpenCode provider fallback
                                  </label>
                                  <TextField>
                                    <TextFieldInput
                                      id="opencode-provider-input"
                                      type="text"
                                      placeholder="openai"
                                      value={aiOpencodeProviderInput()}
                                      onInput={(event) => setAiOpencodeProviderInput(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>

                                  <label
                                    for="opencode-model-input"
                                    class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                                  >
                                    OpenCode model override (optional)
                                  </label>
                                  <TextField>
                                    <TextFieldInput
                                      id="opencode-model-input"
                                      type="text"
                                      placeholder="openai/gpt-5"
                                      value={aiOpencodeModelInput()}
                                      onInput={(event) => setAiOpencodeModelInput(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>

                                  <div class="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                                    <div class="flex items-center justify-between gap-2">
                                      <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                        Bundled sidecar
                                      </p>
                                      <span
                                        class={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${opencodeSidecarStatus()?.available
                                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                                          : "border-rose-500/20 bg-rose-500/10 text-rose-300/90"
                                          }`}
                                      >
                                        {opencodeSidecarStatus()?.available ? "Available" : "Missing"}
                                      </span>
                                    </div>
                                    <Show when={opencodeSidecarStatus()?.version}>
                                      {(version) => (
                                        <p class="mt-2 text-[12px] text-neutral-400">
                                          Version: <span class="font-mono text-neutral-300">{version()}</span>
                                        </p>
                                      )}
                                    </Show>
                                    <Show when={opencodeSidecarStatus()?.detail}>
                                      {(detail) => (
                                        <p class="mt-2 text-[12px] text-neutral-500">{detail()}</p>
                                      )}
                                    </Show>
                                    <Show when={opencodeSidecarLoadError()}>
                                      {(message) => (
                                        <p class="mt-2 text-[12px] text-rose-300/90">{message()}</p>
                                      )}
                                    </Show>
                                  </div>
                                </>
                              </Show>

                              <div class="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={aiSettingsBusy() || aiReviewModelInput().trim().length === 0}
                                >
                                  {aiSettingsBusy() ? "Saving..." : "Save review settings"}
                                </Button>
                              </div>
                            </form>

                            <p class="mt-8 text-[15px] font-medium text-neutral-200">
                              AI Review API Key
                            </p>
                            <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                              Configure <span class="font-mono text-neutral-300">OPENAI_API_KEY</span> for OpenAI-backed models.
                            </p>

                            <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                  Current key
                                </p>
                                <span
                                  class={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${aiReviewConfig()?.hasApiKey
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                                    : "border-white/[0.06] bg-white/[0.03] text-neutral-500"
                                    }`}
                                >
                                  {aiReviewConfig()?.hasApiKey ? "Configured" : "Missing"}
                                </span>
                              </div>
                              <p class="mt-2 text-[13px] text-neutral-400">
                                <Show
                                  when={aiReviewConfig()?.apiKeyPreview}
                                  fallback="No API key configured yet."
                                >
                                  {(preview) => (
                                    <span class="font-mono text-neutral-300">{preview()}</span>
                                  )}
                                </Show>
                              </p>
                            </div>

                            <form class="mt-4" onSubmit={(event) => void handleSaveAiApiKey(event)}>
                              <label
                                for="openai-api-key-input"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                OPENAI_API_KEY
                              </label>
                              <TextField class="mt-2 max-w-xl">
                                <TextFieldInput
                                  id="openai-api-key-input"
                                  type="password"
                                  placeholder="sk-proj-..."
                                  value={aiApiKeyInput()}
                                  onInput={(event) => setAiApiKeyInput(event.currentTarget.value)}
                                  class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                />
                              </TextField>
                              <div class="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={aiApiKeyBusy() || aiApiKeyInput().trim().length === 0}
                                >
                                  {aiApiKeyBusy() ? "Saving..." : "Save API key"}
                                </Button>
                                <span class="text-[12px] text-neutral-500">
                                  Applied immediately for this running app and persisted to <span class="font-mono">.env</span>.
                                </span>
                              </div>
                            </form>

                            <Show when={aiSettingsError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiSettingsStatus()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiReviewConfigLoadError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  Unable to load AI review config: {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiApiKeyError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiApiKeyStatus()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                          </section>
                        </Show>
                      }
                    >
                      <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                        <p class="text-[15px] font-medium text-neutral-200">
                          Diff Theme
                        </p>
                        <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                          Choose which diffs.com theme preset Rovex uses when rendering code diffs.
                        </p>

                        <div class="mt-4 max-w-xl space-y-3">
                          <label
                            for="diff-theme-select"
                            class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                          >
                            Preset
                          </label>
                          <div class="flex flex-wrap items-center gap-2.5">
                            <select
                              id="diff-theme-select"
                              value={selectedDiffThemeId()}
                              onChange={(event) => setSelectedDiffThemeId(event.currentTarget.value)}
                              class="h-11 min-w-[13.5rem] rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[14px] text-neutral-200 outline-none transition-colors hover:border-white/[0.14] focus:border-amber-500/35"
                            >
                              <For each={diffThemePresets}>
                                {(preset) => (
                                  <option value={preset.id}>
                                    {preset.label}
                                  </option>
                                )}
                              </For>
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                              onClick={() => void handleOpenDiffsDocs()}
                            >
                              Browse diffs.com
                            </Button>
                          </div>
                          <p class="text-[13px] leading-relaxed text-neutral-500">
                            {selectedDiffTheme().description}
                          </p>
                          <p class="text-[12.5px] leading-relaxed text-neutral-500">
                            Dark: <span class="font-mono text-neutral-300">{selectedDiffTheme().theme.dark}</span>
                            {" "}
                            Light: <span class="font-mono text-neutral-300">{selectedDiffTheme().theme.light}</span>
                          </p>
                        </div>

                        <div class="mt-6">
                          <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                            Live Preview
                          </p>
                          <div class="mt-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0e1013] p-3">
                            <div class="max-h-[16rem] overflow-y-auto pr-1">
                              <DiffViewer
                                patch={diffThemePreviewPatch}
                                theme={selectedDiffTheme().theme}
                                themeId={selectedDiffTheme().id}
                                themeType="dark"
                                showToolbar={false}
                              />
                            </div>
                          </div>
                        </div>

                        <Show when={settingsError()}>
                          {(message) => (
                            <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                              {message()}
                            </div>
                          )}
                        </Show>
                      </section>
                    </Show>
                  }
                >
                  <div class="mt-10 max-w-3xl space-y-5">
                    <section class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5" style={{ "animation-delay": "0.05s" }}>
                      <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">Provider</p>
                      <div class="mt-3 inline-flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
                        <For each={providerOptions}>
                          {(option) => (
                            <button
                              type="button"
                              class={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${selectedProvider() === option.id
                                ? "bg-white/[0.1] text-neutral-100"
                                : "text-neutral-400 hover:text-neutral-200"
                                }`}
                              onClick={() => setSelectedProvider(option.id)}
                            >
                              {option.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </section>

                    {/* Provider connection card */}
                    <section class="animate-fade-up overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02]" style={{ "animation-delay": "0.08s" }}>
                      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.04] px-6 py-5">
                        <div>
                          <div class="flex items-center gap-2.5">
                            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
                              <PlugZap class="size-4 text-neutral-300" />
                            </div>
                            <p class="text-[15px] font-medium text-neutral-100">{selectedProviderOption().label}</p>
                          </div>
                          <p class="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
                            {selectedProviderOption().description}
                          </p>
                        </div>
                        <span
                          class={`mt-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${selectedProviderConnection()
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                            : "border-white/[0.06] bg-white/[0.03] text-neutral-500"
                            }`}
                        >
                          {selectedProviderConnection() ? "Connected" : "Not connected"}
                        </span>
                      </div>

                      <div class="px-6 py-5">
                        <Show
                          when={selectedProviderConnection()}
                          fallback={
                            <div class="max-w-md space-y-3">
                              <Button
                                type="button"
                                size="sm"
                                disabled={providerBusy() || deviceAuthInProgress()}
                                onClick={() => void handleStartDeviceAuth()}
                              >
                                {providerBusy()
                                  ? "Starting..."
                                  : deviceAuthInProgress()
                                    ? "Waiting for approval..."
                                    : `Connect with ${selectedProviderOption().label}`}
                              </Button>
                              <Show when={deviceAuthInProgress() && deviceAuthUserCode()}>
                                {(userCode) => (
                                  <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200/90">
                                    Enter code <span class="font-semibold tracking-[0.08em]">{userCode()}</span> on {selectedProviderOption().label}.
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      class="mt-3 border-white/[0.1] text-neutral-200 hover:border-white/[0.18]"
                                      onClick={() => void openDeviceVerificationUrl(selectedProviderOption().label)}
                                    >
                                      Open {selectedProviderOption().label} verification
                                    </Button>
                                  </div>
                                )}
                              </Show>
                              <details class="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[13px] text-neutral-400">
                                <summary class="cursor-pointer font-medium text-neutral-300">
                                  Use personal access token instead
                                </summary>
                                <form class="mt-3 space-y-3" onSubmit={(event) => void handleConnectProvider(event)}>
                                  <TextField>
                                    <TextFieldInput
                                      type="password"
                                      placeholder={selectedProviderOption().tokenPlaceholder}
                                      value={providerToken()}
                                      onInput={(event) => setProviderToken(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={providerBusy() || providerToken().trim().length === 0}
                                  >
                                    {providerBusy() ? "Connecting..." : "Connect with token"}
                                  </Button>
                                </form>
                              </details>
                            </div>
                          }
                        >
                          {(connection) => (
                            <div class="flex flex-wrap items-center justify-between gap-3">
                              <p class="text-[14px] text-neutral-400">
                                Authenticated as <span class="font-medium text-amber-300/90">{connection().accountLogin}</span>
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                class="border-white/[0.08] text-neutral-300 hover:border-white/[0.12]"
                                disabled={providerBusy()}
                                onClick={() => void handleDisconnectProvider()}
                              >
                                Disconnect
                              </Button>
                            </div>
                          )}
                        </Show>
                      </div>
                    </section>

                    {/* Clone form card */}
                    <form
                      class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5"
                      style={{ "animation-delay": "0.14s" }}
                      onSubmit={(event) => void handleCloneRepository(event)}
                    >
                      <p class="text-[15px] font-medium text-neutral-200">Clone repository for review</p>
                      <p class="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">
                        {selectedProviderOption().repositoryHint}
                      </p>

                      <TextField class="mt-4 max-w-md">
                        <TextFieldInput
                          placeholder={selectedProvider() === "gitlab" ? "group/subgroup/repository" : "owner/repository"}
                          value={repositoryInput()}
                          onInput={(event) => setRepositoryInput(event.currentTarget.value)}
                          class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                        />
                      </TextField>

                      <div class="mt-3 flex max-w-xl items-center gap-2">
                        <TextField class="min-w-0 flex-1">
                          <TextFieldInput
                            placeholder="Destination root (optional)"
                            value={destinationRoot()}
                            onInput={(event) => setDestinationRoot(event.currentTarget.value)}
                            class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                          />
                        </TextField>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                          onClick={() => void handlePickDestinationRoot()}
                        >
                          <FolderOpen class="mr-1.5 size-4" />
                          Browse
                        </Button>
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        class="mt-4"
                        disabled={
                          providerBusy() ||
                          !selectedProviderConnection() ||
                          repositoryInput().trim().length === 0
                        }
                      >
                        {providerBusy() ? "Working..." : "Clone for review"}
                      </Button>
                    </form>

                    {/* Local project card */}
                    <form
                      class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5"
                      style={{ "animation-delay": "0.18s" }}
                      onSubmit={(event) => void handleCreateLocalProjectThread(event)}
                    >
                      <p class="text-[15px] font-medium text-neutral-200">Use an existing local project</p>
                      <p class="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">
                        Pick any local directory and create a review thread without cloning.
                      </p>

                      <div class="mt-4 flex max-w-xl items-center gap-2">
                        <TextField class="min-w-0 flex-1">
                          <TextFieldInput
                            placeholder="/path/to/local/project"
                            value={localProjectPath()}
                            onInput={(event) => setLocalProjectPath(event.currentTarget.value)}
                            class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                          />
                        </TextField>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                          onClick={() => void handlePickLocalProject()}
                        >
                          <FolderOpen class="mr-1.5 size-4" />
                          Browse
                        </Button>
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        class="mt-4"
                        disabled={providerBusy() || localProjectPath().trim().length === 0}
                      >
                        {providerBusy() ? "Working..." : "Create review from local project"}
                      </Button>
                    </form>

                    {/* Status messages */}
                    <Show when={providerConnectionError()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                          Unable to load provider connection: {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={providerError()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={providerStatus()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                          {message()}
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>
              </main>
            </section>
          </div>
        }
      >
        {/* ── Workspace View ── */}
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

            {/* Main content */}
            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <Show when={branchActionError()}>
                {(message) => (
                  <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={compareError()}>
                {(message) => (
                  <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={aiReviewError()}>
                {(message) => (
                  <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={aiStatus()}>
                {(message) => (
                  <div class="mb-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={aiReviewBusy()}>
                <div class="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200/90">
                  <LoaderCircle class="size-4 animate-spin text-amber-300/90" />
                  <span>
                    Review is running. {aiRunElapsedSeconds()}s elapsed. Notes refresh automatically.
                  </span>
                </div>
              </Show>

              {/* Change summary bar */}
              <div class="mb-3 flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
                <span class="text-neutral-400">{compareSummary() ?? "No review loaded."}</span>
                <div class="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={aiReviewBusy() || compareBusy() || selectedWorkspace().length === 0}
                    onClick={() => void handleStartAiReview()}
                  >
                    {aiReviewBusy()
                      ? "Starting..."
                      : hasReviewStarted()
                        ? "Run review again"
                        : "Start review"}
                  </Button>
                  <button
                    type="button"
                    class="flex items-center gap-1 font-medium text-amber-400/80 transition-colors hover:text-amber-300 disabled:cursor-not-allowed disabled:text-neutral-500"
                    disabled={compareBusy() || selectedWorkspace().length === 0}
                    onClick={() => void handleOpenDiffViewer()}
                  >
                    {compareBusy()
                      ? "Comparing..."
                      : compareResult()
                        ? showDiffViewer()
                          ? "Hide changes"
                          : "Review changes"
                        : `Review vs ${selectedBaseRef()}`}
                    <ChevronRight class="size-3.5" />
                  </button>
                </div>
              </div>

              <Show when={showDiffViewer() && compareResult()}>
                {(result) => (
                  <Show
                    when={result().diff.trim().length > 0}
                    fallback={
                      <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[14px] text-neutral-400">
                        No differences found against {result().baseRef}.
                      </div>
                    }
                  >
                    <DiffViewer
                      patch={result().diff}
                      theme={selectedDiffTheme().theme}
                      themeId={selectedDiffTheme().id}
                      themeType="dark"
                      annotations={diffAnnotations()}
                    />
                  </Show>
                )}
              </Show>

              <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div class="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
                  <h3 class="text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
                    Chunk Reviews
                  </h3>
                  <span class="text-[12px] text-neutral-600">
                    {aiChunkReviews().length} chunks • {aiFindings().length} findings{aiReviewBusy() ? " • live" : ""}
                  </span>
                </div>
                <Show
                  when={aiProgressEvents().length > 0}
                  fallback={null}
                >
                  <div class="max-h-[7rem] space-y-1.5 overflow-y-auto border-b border-white/[0.05] px-4 py-2">
                    <For each={aiProgressEvents().slice(Math.max(0, aiProgressEvents().length - 8))}>
                      {(event) => (
                        <p class="text-[12px] text-neutral-500">
                          {event.message}
                        </p>
                      )}
                    </For>
                  </div>
                </Show>
                <Show
                  when={aiChunkReviews().length > 0}
                  fallback={
                    <p class="px-4 py-4 text-[13px] text-neutral-500">
                      Start review to analyze each diff chunk and generate inline findings.
                    </p>
                  }
                >
                  <div class="max-h-[20rem] space-y-2 overflow-y-auto px-3 py-3">
                    <For each={aiChunkReviews()}>
                      {(chunk) => (
                        <div class="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
                          <div class="mb-1.5 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                            <span class="truncate">{chunk.filePath} • chunk {chunk.chunkIndex}</span>
                            <span class="shrink-0 normal-case text-neutral-600">
                              {chunk.findings.length} finding{chunk.findings.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <p class="text-[13px] leading-5 text-neutral-300">{chunk.summary}</p>
                          <Show when={chunk.findings.length > 0}>
                            <div class="mt-2 space-y-2">
                              <For each={chunk.findings}>
                                {(finding) => (
                                  <div class="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[12.5px] text-amber-100/90">
                                    <p class="font-medium text-amber-200/90">
                                      [{finding.severity}] {finding.title} ({finding.side}:{finding.lineNumber})
                                    </p>
                                    <p class="mt-1 text-amber-100/80">{finding.body}</p>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={threadMessagesLoadError()}>
                  {(message) => (
                    <p class="border-t border-white/[0.05] px-4 py-3 text-[12px] text-rose-300/90">
                      Unable to refresh conversation history: {message()}
                    </p>
                  )}
                </Show>
              </div>
            </div>

            {/* Input area */}
            <footer class="shrink-0 px-6 pb-4 pt-3">
              <form
                class="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                onSubmit={(event) => void handleAskAiFollowUp(event)}
              >
                <TextField>
                  <TextFieldInput
                    value={aiPrompt()}
                    onInput={(event) => setAiPrompt(event.currentTarget.value)}
                    placeholder={
                      hasReviewStarted()
                        ? "Ask a follow-up question about this review..."
                        : "Click Start review above to begin."
                    }
                    class="h-12 border-0 bg-transparent px-4 text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:ring-0 focus:ring-offset-0"
                  />
                </TextField>
                <div class="flex items-center justify-between border-t border-white/[0.04] px-4 py-2.5">
                  <div class="flex items-center gap-3 text-[13px]">
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/[0.05] hover:text-neutral-300">
                      <PlusCircle class="size-4" />
                    </button>
                    <div class="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[12px]">
                      <span class="font-medium text-neutral-300">GPT-5.3-Codex</span>
                      <ChevronRight class="size-3 rotate-90 text-neutral-600" />
                    </div>
                    <span class="text-[12px] text-neutral-600">High</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Popover.Root
                      open={branchPopoverOpen()}
                      onOpenChange={setBranchPopoverOpen}
                      placement="top-end"
                      gutter={8}
                    >
                      <Popover.Trigger
                        as="button"
                        type="button"
                        class="branch-picker-trigger"
                        disabled={selectedWorkspace().length === 0}
                        aria-label="Switch current branch"
                      >
                        <GitBranch class="size-4 text-neutral-400" />
                        <span class="max-w-[8.75rem] truncate">
                          {workspaceBranches.loading && !workspaceBranches()
                            ? "Loading..."
                            : currentWorkspaceBranch()}
                        </span>
                        <ChevronRight class="size-3.5 rotate-90 text-neutral-500" />
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          class="branch-picker-popover"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                        >
                          <div class="branch-picker-search">
                            <Search class="size-4 text-neutral-500" />
                            <input
                              ref={(element) => {
                                branchSearchInputRef = element;
                              }}
                              value={branchSearchQuery()}
                              onInput={(event) =>
                                setBranchSearchQuery(event.currentTarget.value)}
                              class="branch-picker-search-input"
                              placeholder="Search branches"
                            />
                          </div>

                          <p class="branch-picker-section-label">Branches</p>
                          <div class="branch-picker-list">
                            <Show
                              when={!workspaceBranches.loading}
                              fallback={
                                <div class="branch-picker-loading">
                                  <LoaderCircle class="size-4 animate-spin text-neutral-500" />
                                  <span>Loading branches...</span>
                                </div>
                              }
                            >
                              <Show
                                when={filteredWorkspaceBranches().length > 0}
                                fallback={
                                  <p class="px-3 py-2 text-[13px] text-neutral-500">
                                    {workspaceBranchLoadError() ?? "No branches found."}
                                  </p>
                                }
                              >
                                <For each={filteredWorkspaceBranches()}>
                                  {(branch) => (
                                    <button
                                      type="button"
                                      class="branch-picker-item"
                                      disabled={branchActionBusy()}
                                      onClick={() => void handleCheckoutBranch(branch.name)}
                                    >
                                      <span class="flex items-center gap-3 truncate">
                                        <GitBranch class="size-4 text-neutral-500" />
                                        <span class="truncate">{branch.name}</span>
                                      </span>
                                      <Show when={branch.isCurrent}>
                                        <Check class="size-5 text-neutral-100" />
                                      </Show>
                                    </button>
                                  )}
                                </For>
                              </Show>
                            </Show>
                          </div>

                          <div class="branch-picker-create-wrap">
                            <Show
                              when={!branchCreateMode()}
                              fallback={
                                <form
                                  class="branch-picker-create-form"
                                  onSubmit={(event) =>
                                    void handleCreateAndCheckoutBranch(event)}
                                >
                                  <input
                                    ref={(element) => {
                                      branchCreateInputRef = element;
                                    }}
                                    value={newBranchName()}
                                    onInput={(event) =>
                                      setNewBranchName(event.currentTarget.value)}
                                    class="branch-picker-create-input"
                                    placeholder="feature/new-branch"
                                  />
                                  <div class="flex items-center gap-2">
                                    <button
                                      type="button"
                                      class="branch-picker-create-cancel"
                                      onClick={() => {
                                        setBranchCreateMode(false);
                                        setNewBranchName("");
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      class="branch-picker-create-submit"
                                      disabled={!canCreateBranch()}
                                    >
                                      Create
                                    </button>
                                  </div>
                                </form>
                              }
                            >
                              <button
                                type="button"
                                class="branch-picker-create-trigger"
                                disabled={branchActionBusy()}
                                onClick={handleStartCreateBranch}
                              >
                                <PlusCircle class="size-4" />
                                <span>Create and checkout new branch...</span>
                              </button>
                            </Show>
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={
                        aiReviewBusy() ||
                        compareBusy() ||
                        selectedWorkspace().length === 0 ||
                        !hasReviewStarted() ||
                        aiPrompt().trim().length === 0
                      }
                      class="h-8 w-8 rounded-xl bg-amber-500/90 text-neutral-900 shadow-[0_0_12px_rgba(212,175,55,0.15)] hover:bg-amber-400/90 disabled:bg-neutral-700 disabled:text-neutral-400"
                    >
                      <Send class="size-3.5" />
                    </Button>
                  </div>
                </div>
              </form>
            </footer>
          </section>
        </SidebarInset>

      </Show>
    </SidebarProvider>
  );
}

export default App;
