import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkoutWorkspaceBranch,
  cloneRepository,
  connectProvider,
  createThread,
  deleteThread,
  disconnectProvider,
  pollProviderDeviceAuth,
  setAiReviewApiKey,
  setAiReviewSettings,
  startAppServerAccountLogin,
  startProviderDeviceAuth,
  type ProviderKind,
  type StartProviderDeviceAuthResult,
} from "@/lib/backend";
import { providerOption, repoNameFromWorkspace, sleep } from "@/app/helpers";
import type {
  AppView,
  RepoGroup,
  RepoReview,
  RepoReviewDefaults,
  SettingsTab,
} from "@/app/types";

type UseProviderAndSettingsActionsArgs = {
  providerState: {
    selectedProvider: Accessor<ProviderKind>;
    setSelectedProvider: Setter<ProviderKind>;
    providerToken: Accessor<string>;
    setProviderToken: Setter<string>;
    repositoryInput: Accessor<string>;
    setRepositoryInput: Setter<string>;
    destinationRoot: Accessor<string>;
    setDestinationRoot: Setter<string>;
    localProjectPath: Accessor<string>;
    setLocalProjectPath: Setter<string>;
    providerBusy: Accessor<boolean>;
    setProviderBusy: Setter<boolean>;
    providerError: Accessor<string | null>;
    setProviderError: Setter<string | null>;
    providerStatus: Accessor<string | null>;
    setProviderStatus: Setter<string | null>;
    deviceAuthInProgress: Accessor<boolean>;
    setDeviceAuthInProgress: Setter<boolean>;
    deviceAuthUserCode: Accessor<string | null>;
    setDeviceAuthUserCode: Setter<string | null>;
    deviceAuthVerificationUrl: Accessor<string | null>;
    setDeviceAuthVerificationUrl: Setter<string | null>;
  };
  navigation: {
    setActiveView: Setter<AppView>;
    setActiveSettingsTab: Setter<SettingsTab>;
  };
  connectionRefetch: {
    refetchGithubConnection: () => unknown;
    refetchGitlabConnection: () => unknown;
  };
  repoState: {
    refetchThreads: () => unknown;
    setSelectedThreadId: Setter<number | null>;
    selectedBaseRef: Accessor<string>;
    setSelectedBaseRef: Setter<string>;
    reviewDefaultsByRepo: Accessor<Record<string, RepoReviewDefaults>>;
    setReviewDefaultsByRepo: Setter<Record<string, RepoReviewDefaults>>;
    knownRepoWorkspaces: Accessor<Record<string, string>>;
    setKnownRepoWorkspaces: Setter<Record<string, string>>;
    repoDisplayNames: Accessor<Record<string, string>>;
    setRepoDisplayNames: Setter<Record<string, string>>;
    collapsedRepos: Accessor<Record<string, boolean>>;
    setCollapsedRepos: Setter<Record<string, boolean>>;
    repoMenuOpen: Accessor<Record<string, boolean>>;
    setRepoMenuOpen: Setter<Record<string, boolean>>;
  };
  settingsState: {
    setSettingsError: Setter<string | null>;
  };
  aiSettingsState: {
    aiReviewProviderInput: Accessor<string>;
    aiReviewModelInput: Accessor<string>;
    aiOpencodeProviderInput: Accessor<string>;
    aiOpencodeModelInput: Accessor<string>;
    aiSettingsBusy: Accessor<boolean>;
    setAiSettingsBusy: Setter<boolean>;
    setAiSettingsError: Setter<string | null>;
    setAiSettingsStatus: Setter<string | null>;
    refetchAiReviewConfig: () => unknown;
  };
  accountState: {
    appServerAuthBusy: Accessor<boolean>;
    setAppServerAuthBusy: Setter<boolean>;
    setAppServerAuthError: Setter<string | null>;
    setAppServerAuthStatus: Setter<string | null>;
    refetchAppServerAccountStatus: () => unknown;
    refetchOpencodeSidecarStatus: () => unknown;
  };
  apiKeyState: {
    aiApiKeyInput: Accessor<string>;
    setAiApiKeyInput: Setter<string>;
    aiApiKeyBusy: Accessor<boolean>;
    setAiApiKeyBusy: Setter<boolean>;
    setAiApiKeyError: Setter<string | null>;
    setAiApiKeyStatus: Setter<string | null>;
  };
};

export function useProviderAndSettingsActions(args: UseProviderAndSettingsActionsArgs) {
  const {
    providerState,
    navigation,
    connectionRefetch,
    repoState,
    settingsState,
    aiSettingsState,
    accountState,
    apiKeyState,
  } = args;

  let deviceAuthSession = 0;

  const clearProviderNotice = () => {
    providerState.setProviderError(null);
    providerState.setProviderStatus(null);
  };

  const refetchProviderConnection = async (provider: ProviderKind) => {
    if (provider === "github") {
      await connectionRefetch.refetchGithubConnection();
      return;
    }
    await connectionRefetch.refetchGitlabConnection();
  };

  const cancelDeviceAuthFlow = () => {
    deviceAuthSession += 1;
    providerState.setDeviceAuthInProgress(false);
    providerState.setDeviceAuthUserCode(null);
    providerState.setDeviceAuthVerificationUrl(null);
  };

  onCleanup(() => {
    cancelDeviceAuthFlow();
  });

  createEffect(() => {
    providerState.selectedProvider();
    clearProviderNotice();
    cancelDeviceAuthFlow();
    providerState.setProviderToken("");
    providerState.setRepositoryInput("");
  });

  const openDeviceVerificationUrl = async (providerLabel: string) => {
    const url = providerState.deviceAuthVerificationUrl();
    if (!url) return;

    try {
      await openUrl(url);
    } catch (error) {
      providerState.setProviderError(
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
          providerState.setProviderStatus(`Connected ${label} as ${result.connection.accountLogin}.`);
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
        providerState.setProviderError(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (sessionId !== deviceAuthSession) {
      return;
    }
    cancelDeviceAuthFlow();
    providerState.setProviderError(`${label} sign-in timed out. Start again.`);
  };

  const handleStartDeviceAuth = async () => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    const sessionId = deviceAuthSession;

    providerState.setProviderBusy(true);
    try {
      const flow = await startProviderDeviceAuth({ provider });
      const verificationUrl = flow.verificationUriComplete ?? flow.verificationUri;

      providerState.setDeviceAuthInProgress(true);
      providerState.setDeviceAuthUserCode(flow.userCode);
      providerState.setDeviceAuthVerificationUrl(verificationUrl);
      providerState.setProviderStatus(`Enter code ${flow.userCode} in ${selected.label} to finish connecting.`);

      await openDeviceVerificationUrl(selected.label);
      void pollProviderDeviceAuthFlow(sessionId, provider, flow);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      cancelDeviceAuthFlow();
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const openSettings = (tab: SettingsTab = "connections") => {
    navigation.setActiveSettingsTab(tab);
    navigation.setActiveView("settings");
  };

  const closeSettings = () => {
    navigation.setActiveView("workspace");
  };

  const handleConnectProvider = async (event: Event) => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();
    cancelDeviceAuthFlow();

    const token = providerState.providerToken().trim();
    if (!token) {
      providerState.setProviderError(`Enter a ${selected.label} personal access token.`);
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const connection = await connectProvider({ provider, accessToken: token });
      providerState.setProviderToken("");
      await refetchProviderConnection(provider);
      providerState.setProviderStatus(`Connected ${selected.label} as ${connection.accountLogin}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleDisconnectProvider = async () => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    providerState.setProviderBusy(true);
    try {
      await disconnectProvider(provider);
      await refetchProviderConnection(provider);
      providerState.setProviderStatus(`Disconnected ${selected.label}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleCloneRepository = async (event: Event) => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();

    const repository = providerState.repositoryInput().trim();
    if (!repository) {
      providerState.setProviderError(`Enter a ${selected.label} repository path or URL.`);
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const cloneResult = await cloneRepository({
        provider,
        repository,
        destinationRoot: providerState.destinationRoot().trim() || null,
        shallow: true,
      });

      await createThread({
        title: `Review ${cloneResult.repository}`,
        workspace: cloneResult.workspace,
      });
      await repoState.refetchThreads();

      providerState.setRepositoryInput("");
      providerState.setProviderStatus(
        `Cloned ${cloneResult.repository} to ${cloneResult.workspace} and created a review thread.`
      );
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
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
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const handlePickDestinationRoot = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(providerState.destinationRoot());
    if (!selectedPath) return;
    providerState.setDestinationRoot(selectedPath);
  };

  const handlePickLocalProject = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(providerState.localProjectPath());
    if (!selectedPath) return;
    providerState.setLocalProjectPath(selectedPath);
  };

  const handleCreateLocalProjectThread = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

    const workspace = providerState.localProjectPath().trim();
    if (!workspace) {
      providerState.setProviderError("Select a local project directory.");
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(workspace)}`,
        workspace,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      providerState.setLocalProjectPath("");
      providerState.setProviderStatus(`Added local project ${workspace} and created a review thread.`);
      navigation.setActiveView("workspace");
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleAddLocalRepoFromSidebar = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory();
    if (!selectedPath) return;

    providerState.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(selectedPath)}`,
        workspace: selectedPath,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      providerState.setProviderStatus(`Added local project ${selectedPath} and created a review thread.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const isRepoCollapsed = (repoName: string) => repoState.collapsedRepos()[repoName] ?? false;
  const repoDisplayName = (repoName: string) => repoState.repoDisplayNames()[repoName] ?? repoName;
  const isRepoMenuOpen = (repoName: string) => repoState.repoMenuOpen()[repoName] ?? false;

  const toggleRepoCollapsed = (repoName: string) => {
    repoState.setCollapsedRepos((current) => ({
      ...current,
      [repoName]: !(current[repoName] ?? false),
    }));
  };

  const setRepoMenuOpenState = (repoName: string, open: boolean) => {
    repoState.setRepoMenuOpen((current) => ({
      ...current,
      [repoName]: open,
    }));
  };

  const makeReviewTitle = (repoName: string, goal: string) => {
    const displayName = repoDisplayName(repoName);
    const normalizedGoal = goal.trim();
    if (!normalizedGoal) {
      return `Review ${displayName}`;
    }
    const truncated =
      normalizedGoal.length > 72 ? `${normalizedGoal.slice(0, 69).trimEnd()}...` : normalizedGoal;
    return `Review ${displayName} - ${truncated}`;
  };

  const normalizeReviewGoal = (goal: string | null | undefined, repoName: string) => {
    const normalized = goal?.trim();
    if (normalized) return normalized;
    return `Review recent changes in ${repoDisplayName(repoName)}.`;
  };

  const normalizeBaseRef = (baseRef: string | null | undefined) => {
    const normalized = baseRef?.trim();
    if (normalized) return normalized;
    const selected = repoState.selectedBaseRef().trim();
    if (selected) return selected;
    return "origin/main";
  };

  const normalizeReviewBranch = (reviewBranch: string | null | undefined) => {
    const normalized = reviewBranch?.trim();
    if (normalized) return normalized;
    return "";
  };

  const handleCreateReviewForRepo = async (
    repo: RepoGroup,
    draft?: Partial<RepoReviewDefaults>
  ): Promise<boolean> => {
    clearProviderNotice();
    const workspace =
      repo.reviews.find((review) => review.workspace?.trim())?.workspace?.trim() ??
      repo.workspace?.trim() ??
      repoState.knownRepoWorkspaces()[repo.repoName]?.trim();
    if (!workspace) {
      providerState.setProviderError(`No local workspace found for ${repo.repoName}.`);
      return false;
    }

    const savedDefaults = repoState.reviewDefaultsByRepo()[repo.repoName];
    const goal = normalizeReviewGoal(draft?.goal ?? savedDefaults?.goal, repo.repoName);
    const baseRef = normalizeBaseRef(draft?.baseRef ?? savedDefaults?.baseRef);
    const reviewBranch = normalizeReviewBranch(draft?.reviewBranch ?? savedDefaults?.reviewBranch);

    providerState.setProviderBusy(true);
    try {
      if (reviewBranch) {
        await checkoutWorkspaceBranch({
          workspace,
          branchName: reviewBranch,
        });
      }
      const thread = await createThread({
        title: makeReviewTitle(repo.repoName, goal),
        workspace,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      repoState.setSelectedBaseRef(baseRef);
      repoState.setReviewDefaultsByRepo((current) => ({
        ...current,
        [repo.repoName]: reviewBranch ? { goal, baseRef, reviewBranch } : { goal, baseRef },
      }));
      repoState.setCollapsedRepos((current) => ({ ...current, [repo.repoName]: false }));
      providerState.setProviderStatus(
        `Created a new review for ${repoDisplayName(repo.repoName)} on ${reviewBranch || "current branch"} (vs ${baseRef}).`
      );
      setRepoMenuOpenState(repo.repoName, false);
      return true;
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleRenameRepo = (repo: RepoGroup) => {
    const existingName = repoDisplayName(repo.repoName);
    const nextName = window.prompt("Edit repository name", existingName)?.trim();
    if (!nextName) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    repoState.setRepoDisplayNames((current) => {
      const next = { ...current };
      next[repo.repoName] = nextName;
      return next;
    });
    providerState.setProviderStatus(`Renamed ${repo.repoName} to ${nextName}.`);
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
    providerState.setProviderBusy(true);
    try {
      for (const review of repo.reviews) {
        await deleteThread(review.id);
      }
      await repoState.refetchThreads();
      repoState.setRepoDisplayNames((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      repoState.setCollapsedRepos((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      repoState.setKnownRepoWorkspaces((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      providerState.setProviderStatus(
        `Removed ${displayName} with ${reviewCount} review${reviewCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
      setRepoMenuOpenState(repo.repoName, false);
    }
  };

  const handleRemoveReview = async (repo: RepoGroup, review: RepoReview) => {
    const displayName = repoDisplayName(repo.repoName);
    const reviewTitle = review.title?.trim() || "Untitled review";
    const workspace = review.workspace?.trim() || repo.workspace?.trim() || null;
    const confirmed = window.confirm(
      `Remove review "${reviewTitle}" from ${displayName}? Local files are not deleted.`
    );
    if (!confirmed) {
      return;
    }

    clearProviderNotice();
    providerState.setProviderBusy(true);
    try {
      if (workspace) {
        repoState.setKnownRepoWorkspaces((current) =>
          current[repo.repoName] === workspace
            ? current
            : {
                ...current,
                [repo.repoName]: workspace,
              }
        );
      }
      await deleteThread(review.id);
      await repoState.refetchThreads();

      providerState.setProviderStatus(`Removed review "${reviewTitle}" from ${displayName}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleOpenDiffsDocs = async () => {
    settingsState.setSettingsError(null);
    try {
      await openUrl("https://diffs.com/");
    } catch (error) {
      settingsState.setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearAiApiKeyNotice = () => {
    apiKeyState.setAiApiKeyError(null);
    apiKeyState.setAiApiKeyStatus(null);
  };

  const clearAiSettingsNotice = () => {
    aiSettingsState.setAiSettingsError(null);
    aiSettingsState.setAiSettingsStatus(null);
  };

  const clearAppServerAuthNotice = () => {
    accountState.setAppServerAuthError(null);
    accountState.setAppServerAuthStatus(null);
  };

  createEffect(() => {
    const provider = aiSettingsState.aiReviewProviderInput().trim().toLowerCase();
    if (provider !== "app-server") {
      clearAppServerAuthNotice();
    }
  });

  const handleSaveAiSettings = async (event: Event) => {
    event.preventDefault();
    clearAiSettingsNotice();

    const provider = aiSettingsState.aiReviewProviderInput().trim().toLowerCase();
    const model = aiSettingsState.aiReviewModelInput().trim();
    const opencodeProvider = aiSettingsState.aiOpencodeProviderInput().trim();
    const opencodeModel = aiSettingsState.aiOpencodeModelInput().trim();

    if (provider !== "openai" && provider !== "opencode" && provider !== "app-server") {
      aiSettingsState.setAiSettingsError("Provider must be openai, opencode, or app-server.");
      return;
    }
    if (!model) {
      aiSettingsState.setAiSettingsError("Enter a review model.");
      return;
    }

    aiSettingsState.setAiSettingsBusy(true);
    try {
      await setAiReviewSettings({
        reviewProvider: provider,
        reviewModel: model,
        opencodeProvider: opencodeProvider || "openai",
        opencodeModel: opencodeModel || null,
        persistToEnv: true,
      });
      await aiSettingsState.refetchAiReviewConfig();
      if (provider === "opencode") {
        await accountState.refetchOpencodeSidecarStatus();
      } else if (provider === "app-server") {
        await accountState.refetchAppServerAccountStatus();
      }
      aiSettingsState.setAiSettingsStatus(
        provider === "opencode"
          ? "Saved AI review settings for bundled OpenCode provider."
          : "Saved AI review settings."
      );
    } catch (error) {
      aiSettingsState.setAiSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      aiSettingsState.setAiSettingsBusy(false);
    }
  };

  const handleSwitchAppServerAccount = async () => {
    if (accountState.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    accountState.setAppServerAuthBusy(true);
    try {
      const login = await startAppServerAccountLogin();
      await openUrl(login.authUrl);
      accountState.setAppServerAuthStatus(
        "Opened Codex sign-in in your browser. Finish login, then refresh account status."
      );
    } catch (error) {
      accountState.setAppServerAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      accountState.setAppServerAuthBusy(false);
    }
  };

  const handleRefreshAppServerAccountStatus = async () => {
    if (accountState.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    accountState.setAppServerAuthBusy(true);
    try {
      await accountState.refetchAppServerAccountStatus();
      accountState.setAppServerAuthStatus("Refreshed Codex account status.");
    } catch (error) {
      accountState.setAppServerAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      accountState.setAppServerAuthBusy(false);
    }
  };

  const handleSaveAiApiKey = async (event: Event) => {
    event.preventDefault();
    clearAiApiKeyNotice();

    const apiKey = apiKeyState.aiApiKeyInput().trim();
    if (!apiKey) {
      apiKeyState.setAiApiKeyError("Enter an API key.");
      return;
    }

    apiKeyState.setAiApiKeyBusy(true);
    try {
      const config = await setAiReviewApiKey({
        apiKey,
        persistToEnv: true,
      });
      apiKeyState.setAiApiKeyInput("");
      await aiSettingsState.refetchAiReviewConfig();
      apiKeyState.setAiApiKeyStatus(
        config.envFilePath
          ? `Saved OPENAI_API_KEY to ${config.envFilePath}.`
          : "Saved OPENAI_API_KEY."
      );
    } catch (error) {
      apiKeyState.setAiApiKeyError(error instanceof Error ? error.message : String(error));
    } finally {
      apiKeyState.setAiApiKeyBusy(false);
    }
  };

  return {
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
  };
}
