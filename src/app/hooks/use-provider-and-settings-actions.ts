import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
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
  setActiveView: Setter<AppView>;
  setActiveSettingsTab: Setter<SettingsTab>;
  refetchGithubConnection: () => unknown;
  refetchGitlabConnection: () => unknown;
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
  settingsError: Accessor<string | null>;
  setSettingsError: Setter<string | null>;
  aiReviewProviderInput: Accessor<string>;
  aiReviewModelInput: Accessor<string>;
  aiOpencodeProviderInput: Accessor<string>;
  aiOpencodeModelInput: Accessor<string>;
  aiSettingsBusy: Accessor<boolean>;
  setAiSettingsBusy: Setter<boolean>;
  setAiSettingsError: Setter<string | null>;
  setAiSettingsStatus: Setter<string | null>;
  appServerAuthBusy: Accessor<boolean>;
  setAppServerAuthBusy: Setter<boolean>;
  setAppServerAuthError: Setter<string | null>;
  setAppServerAuthStatus: Setter<string | null>;
  aiApiKeyInput: Accessor<string>;
  setAiApiKeyInput: Setter<string>;
  aiApiKeyBusy: Accessor<boolean>;
  setAiApiKeyBusy: Setter<boolean>;
  setAiApiKeyError: Setter<string | null>;
  setAiApiKeyStatus: Setter<string | null>;
  refetchAiReviewConfig: () => unknown;
  refetchAppServerAccountStatus: () => unknown;
  refetchOpencodeSidecarStatus: () => unknown;
};

export function useProviderAndSettingsActions(args: UseProviderAndSettingsActionsArgs) {
  let deviceAuthSession = 0;

  const clearProviderNotice = () => {
    args.setProviderError(null);
    args.setProviderStatus(null);
  };

  const refetchProviderConnection = async (provider: ProviderKind) => {
    if (provider === "github") {
      await args.refetchGithubConnection();
      return;
    }
    await args.refetchGitlabConnection();
  };

  const cancelDeviceAuthFlow = () => {
    deviceAuthSession += 1;
    args.setDeviceAuthInProgress(false);
    args.setDeviceAuthUserCode(null);
    args.setDeviceAuthVerificationUrl(null);
  };

  onCleanup(() => {
    cancelDeviceAuthFlow();
  });

  createEffect(() => {
    args.selectedProvider();
    clearProviderNotice();
    cancelDeviceAuthFlow();
    args.setProviderToken("");
    args.setRepositoryInput("");
  });

  const openDeviceVerificationUrl = async (providerLabel: string) => {
    const url = args.deviceAuthVerificationUrl();
    if (!url) return;

    try {
      await openUrl(url);
    } catch (error) {
      args.setProviderError(
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
          args.setProviderStatus(`Connected ${label} as ${result.connection.accountLogin}.`);
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
        args.setProviderError(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (sessionId !== deviceAuthSession) {
      return;
    }
    cancelDeviceAuthFlow();
    args.setProviderError(`${label} sign-in timed out. Start again.`);
  };

  const handleStartDeviceAuth = async () => {
    const provider = args.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    const sessionId = deviceAuthSession;

    args.setProviderBusy(true);
    try {
      const flow = await startProviderDeviceAuth({ provider });
      const verificationUrl = flow.verificationUriComplete ?? flow.verificationUri;

      args.setDeviceAuthInProgress(true);
      args.setDeviceAuthUserCode(flow.userCode);
      args.setDeviceAuthVerificationUrl(verificationUrl);
      args.setProviderStatus(`Enter code ${flow.userCode} in ${selected.label} to finish connecting.`);

      await openDeviceVerificationUrl(selected.label);
      void pollProviderDeviceAuthFlow(sessionId, provider, flow);
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
      cancelDeviceAuthFlow();
    } finally {
      args.setProviderBusy(false);
    }
  };

  const openSettings = (tab: SettingsTab = "connections") => {
    args.setActiveSettingsTab(tab);
    args.setActiveView("settings");
  };

  const closeSettings = () => {
    args.setActiveView("workspace");
  };

  const handleConnectProvider = async (event: Event) => {
    const provider = args.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();
    cancelDeviceAuthFlow();

    const token = args.providerToken().trim();
    if (!token) {
      args.setProviderError(`Enter a ${selected.label} personal access token.`);
      return;
    }

    args.setProviderBusy(true);
    try {
      const connection = await connectProvider({ provider, accessToken: token });
      args.setProviderToken("");
      await refetchProviderConnection(provider);
      args.setProviderStatus(`Connected ${selected.label} as ${connection.accountLogin}.`);
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
    }
  };

  const handleDisconnectProvider = async () => {
    const provider = args.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    args.setProviderBusy(true);
    try {
      await disconnectProvider(provider);
      await refetchProviderConnection(provider);
      args.setProviderStatus(`Disconnected ${selected.label}.`);
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
    }
  };

  const handleCloneRepository = async (event: Event) => {
    const provider = args.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();

    const repository = args.repositoryInput().trim();
    if (!repository) {
      args.setProviderError(`Enter a ${selected.label} repository path or URL.`);
      return;
    }

    args.setProviderBusy(true);
    try {
      const cloneResult = await cloneRepository({
        provider,
        repository,
        destinationRoot: args.destinationRoot().trim() || null,
        shallow: true,
      });

      await createThread({
        title: `Review ${cloneResult.repository}`,
        workspace: cloneResult.workspace,
      });
      await args.refetchThreads();

      args.setRepositoryInput("");
      args.setProviderStatus(
        `Cloned ${cloneResult.repository} to ${cloneResult.workspace} and created a review thread.`
      );
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
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
      args.setProviderError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const handlePickDestinationRoot = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(args.destinationRoot());
    if (!selectedPath) return;
    args.setDestinationRoot(selectedPath);
  };

  const handlePickLocalProject = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(args.localProjectPath());
    if (!selectedPath) return;
    args.setLocalProjectPath(selectedPath);
  };

  const handleCreateLocalProjectThread = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

    const workspace = args.localProjectPath().trim();
    if (!workspace) {
      args.setProviderError("Select a local project directory.");
      return;
    }

    args.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(workspace)}`,
        workspace,
      });
      await args.refetchThreads();
      args.setSelectedThreadId(thread.id);
      args.setLocalProjectPath("");
      args.setProviderStatus(`Added local project ${workspace} and created a review thread.`);
      args.setActiveView("workspace");
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
    }
  };

  const handleAddLocalRepoFromSidebar = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory();
    if (!selectedPath) return;

    args.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(selectedPath)}`,
        workspace: selectedPath,
      });
      await args.refetchThreads();
      args.setSelectedThreadId(thread.id);
      args.setProviderStatus(`Added local project ${selectedPath} and created a review thread.`);
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
    }
  };

  const isRepoCollapsed = (repoName: string) => args.collapsedRepos()[repoName] ?? false;
  const repoDisplayName = (repoName: string) => args.repoDisplayNames()[repoName] ?? repoName;
  const isRepoMenuOpen = (repoName: string) => args.repoMenuOpen()[repoName] ?? false;

  const toggleRepoCollapsed = (repoName: string) => {
    args.setCollapsedRepos((current) => ({
      ...current,
      [repoName]: !(current[repoName] ?? false),
    }));
  };

  const setRepoMenuOpenState = (repoName: string, open: boolean) => {
    args.setRepoMenuOpen((current) => ({
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
    const selected = args.selectedBaseRef().trim();
    if (selected) return selected;
    return "main";
  };

  const handleCreateReviewForRepo = async (
    repo: RepoGroup,
    draft?: Partial<RepoReviewDefaults>
  ): Promise<boolean> => {
    clearProviderNotice();
    const workspace =
      repo.reviews.find((review) => review.workspace?.trim())?.workspace?.trim() ??
      repo.workspace?.trim() ??
      args.knownRepoWorkspaces()[repo.repoName]?.trim();
    if (!workspace) {
      args.setProviderError(`No local workspace found for ${repo.repoName}.`);
      return false;
    }

    const savedDefaults = args.reviewDefaultsByRepo()[repo.repoName];
    const goal = normalizeReviewGoal(draft?.goal ?? savedDefaults?.goal, repo.repoName);
    const baseRef = normalizeBaseRef(draft?.baseRef ?? savedDefaults?.baseRef);

    args.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: makeReviewTitle(repo.repoName, goal),
        workspace,
      });
      await args.refetchThreads();
      args.setSelectedThreadId(thread.id);
      args.setSelectedBaseRef(baseRef);
      args.setReviewDefaultsByRepo((current) => ({
        ...current,
        [repo.repoName]: { goal, baseRef },
      }));
      args.setCollapsedRepos((current) => ({ ...current, [repo.repoName]: false }));
      args.setProviderStatus(
        `Created a new review for ${repoDisplayName(repo.repoName)} (vs ${baseRef}).`
      );
      setRepoMenuOpenState(repo.repoName, false);
      return true;
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      args.setProviderBusy(false);
    }
  };

  const handleRenameRepo = (repo: RepoGroup) => {
    const existingName = repoDisplayName(repo.repoName);
    const nextName = window.prompt("Edit repository name", existingName)?.trim();
    if (!nextName) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    args.setRepoDisplayNames((current) => {
      const next = { ...current };
      next[repo.repoName] = nextName;
      return next;
    });
    args.setProviderStatus(`Renamed ${repo.repoName} to ${nextName}.`);
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
    args.setProviderBusy(true);
    try {
      for (const review of repo.reviews) {
        await deleteThread(review.id);
      }
      await args.refetchThreads();
      args.setRepoDisplayNames((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      args.setCollapsedRepos((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      args.setKnownRepoWorkspaces((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      args.setProviderStatus(
        `Removed ${displayName} with ${reviewCount} review${reviewCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
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
    args.setProviderBusy(true);
    try {
      if (workspace) {
        args.setKnownRepoWorkspaces((current) =>
          current[repo.repoName] === workspace
            ? current
            : {
                ...current,
                [repo.repoName]: workspace,
              }
        );
      }
      await deleteThread(review.id);
      await args.refetchThreads();

      args.setProviderStatus(`Removed review "${reviewTitle}" from ${displayName}.`);
    } catch (error) {
      args.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setProviderBusy(false);
    }
  };

  const handleOpenDiffsDocs = async () => {
    args.setSettingsError(null);
    try {
      await openUrl("https://diffs.com/");
    } catch (error) {
      args.setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearAiApiKeyNotice = () => {
    args.setAiApiKeyError(null);
    args.setAiApiKeyStatus(null);
  };

  const clearAiSettingsNotice = () => {
    args.setAiSettingsError(null);
    args.setAiSettingsStatus(null);
  };

  const clearAppServerAuthNotice = () => {
    args.setAppServerAuthError(null);
    args.setAppServerAuthStatus(null);
  };

  createEffect(() => {
    const provider = args.aiReviewProviderInput().trim().toLowerCase();
    if (provider !== "app-server") {
      clearAppServerAuthNotice();
    }
  });

  const handleSaveAiSettings = async (event: Event) => {
    event.preventDefault();
    clearAiSettingsNotice();

    const provider = args.aiReviewProviderInput().trim().toLowerCase();
    const model = args.aiReviewModelInput().trim();
    const opencodeProvider = args.aiOpencodeProviderInput().trim();
    const opencodeModel = args.aiOpencodeModelInput().trim();

    if (provider !== "openai" && provider !== "opencode" && provider !== "app-server") {
      args.setAiSettingsError("Provider must be openai, opencode, or app-server.");
      return;
    }
    if (!model) {
      args.setAiSettingsError("Enter a review model.");
      return;
    }

    args.setAiSettingsBusy(true);
    try {
      await setAiReviewSettings({
        reviewProvider: provider,
        reviewModel: model,
        opencodeProvider: opencodeProvider || "openai",
        opencodeModel: opencodeModel || null,
        persistToEnv: true,
      });
      await args.refetchAiReviewConfig();
      if (provider === "opencode") {
        await args.refetchOpencodeSidecarStatus();
      } else if (provider === "app-server") {
        await args.refetchAppServerAccountStatus();
      }
      args.setAiSettingsStatus(
        provider === "opencode"
          ? "Saved AI review settings for bundled OpenCode provider."
          : "Saved AI review settings."
      );
    } catch (error) {
      args.setAiSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setAiSettingsBusy(false);
    }
  };

  const handleSwitchAppServerAccount = async () => {
    if (args.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    args.setAppServerAuthBusy(true);
    try {
      const login = await startAppServerAccountLogin();
      await openUrl(login.authUrl);
      args.setAppServerAuthStatus(
        "Opened Codex sign-in in your browser. Finish login, then refresh account status."
      );
    } catch (error) {
      args.setAppServerAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setAppServerAuthBusy(false);
    }
  };

  const handleRefreshAppServerAccountStatus = async () => {
    if (args.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    args.setAppServerAuthBusy(true);
    try {
      await args.refetchAppServerAccountStatus();
      args.setAppServerAuthStatus("Refreshed Codex account status.");
    } catch (error) {
      args.setAppServerAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setAppServerAuthBusy(false);
    }
  };

  const handleSaveAiApiKey = async (event: Event) => {
    event.preventDefault();
    clearAiApiKeyNotice();

    const apiKey = args.aiApiKeyInput().trim();
    if (!apiKey) {
      args.setAiApiKeyError("Enter an API key.");
      return;
    }

    args.setAiApiKeyBusy(true);
    try {
      const config = await setAiReviewApiKey({
        apiKey,
        persistToEnv: true,
      });
      args.setAiApiKeyInput("");
      await args.refetchAiReviewConfig();
      args.setAiApiKeyStatus(
        config.envFilePath
          ? `Saved OPENAI_API_KEY to ${config.envFilePath}.`
          : "Saved OPENAI_API_KEY."
      );
    } catch (error) {
      args.setAiApiKeyError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setAiApiKeyBusy(false);
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
