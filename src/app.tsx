import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDot,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Monitor,
  Palette,
  Pencil,
  PlusCircle,
  PlugZap,
  Search,
  Send,
  Server,
  SlidersHorizontal,
  Trash2,
  Workflow,
} from "lucide-solid";
import * as Popover from "@kobalte/core/popover";
import { Button } from "@/components/button";
import { DiffViewer, type DiffViewerTheme } from "@/components/diff-viewer";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/sidebar";
import { TextField, TextFieldInput } from "@/components/text-field";
import {
  checkoutWorkspaceBranch,
  compareWorkspaceDiff,
  cloneRepository,
  connectProvider,
  createWorkspaceBranch,
  createThread,
  deleteThread,
  disconnectProvider,
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
  type AiReviewConfig,
  type CompareWorkspaceDiffResult,
  type ListWorkspaceBranchesResult,
  type Message as ThreadMessage,
  type OpencodeSidecarStatus,
  type ProviderConnection,
  type ProviderKind,
  type StartProviderDeviceAuthResult,
  type Thread,
} from "@/lib/backend";
import "./app.css";

type AppView = "workspace" | "settings";

type SettingsTab =
  | "general"
  | "configuration"
  | "personalization"
  | "mcpServers"
  | "git"
  | "environments"
  | "worktrees"
  | "archivedThreads"
  | "connections";

type SettingsNavItem = {
  id: SettingsTab;
  label: string;
  description: string;
  icon: Component<{ class?: string }>;
};

type RepoReview = {
  id: number;
  repoName: string;
  title: string;
  age: string;
  workspace: string | null;
};

type RepoGroup = {
  repoName: string;
  reviews: RepoReview[];
};

type DiffThemePreset = {
  id: string;
  label: string;
  description: string;
  theme: DiffViewerTheme;
};

type ProviderOption = {
  id: ProviderKind;
  label: string;
  description: string;
  repositoryHint: string;
  tokenPlaceholder: string;
};

const settingsNavItems: SettingsNavItem[] = [
  {
    id: "general",
    label: "General",
    description: "Configure app-wide defaults and baseline behavior.",
    icon: CircleDot,
  },
  {
    id: "configuration",
    label: "Configuration",
    description: "Manage global settings applied to your entire Rovex workspace.",
    icon: SlidersHorizontal,
  },
  {
    id: "personalization",
    label: "Personalization",
    description: "Control how Rovex looks and feels for your workflow.",
    icon: Palette,
  },
  {
    id: "mcpServers",
    label: "MCP servers",
    description: "Review and manage connected MCP server integrations.",
    icon: Server,
  },
  {
    id: "git",
    label: "Git",
    description: "Tune repository defaults and Git execution behavior.",
    icon: GitBranch,
  },
  {
    id: "environments",
    label: "Environments",
    description: "Set environment-level options for local and remote contexts.",
    icon: Monitor,
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Manage worktree-specific defaults and workspace policies.",
    icon: Workflow,
  },
  {
    id: "archivedThreads",
    label: "Archived threads",
    description: "Review and restore archived review conversations.",
    icon: Archive,
  },
  {
    id: "connections",
    label: "Connections",
    description: "Connect providers used for cloning repositories and code review.",
    icon: PlugZap,
  },
];

const UNKNOWN_REPO = "unknown-repo";
const REPO_DISPLAY_NAME_STORAGE_KEY = "rovex.settings.repo-display-names";
const DIFF_THEME_STORAGE_KEY = "rovex.settings.diff-theme";
const DEFAULT_DIFF_THEME_ID = "rovex";
const diffThemePresets: DiffThemePreset[] = [
  {
    id: "rovex",
    label: "Rovex",
    description: "Amber-forward palette matched to Rovex's glass and graphite UI.",
    theme: { dark: "rovex-dark", light: "rovex-light" },
  },
  {
    id: "pierre",
    label: "Pierre",
    description: "Default diffs.com theme pair used in Rovex.",
    theme: { dark: "pierre-dark", light: "pierre-light" },
  },
  {
    id: "github",
    label: "GitHub",
    description: "GitHub-style syntax colors and contrast.",
    theme: { dark: "github-dark", light: "github-light" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    description: "Softer palette with reduced glare in dark mode.",
    theme: { dark: "catppuccin-mocha", light: "catppuccin-latte" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    description: "Warm, muted contrast tuned for long reading sessions.",
    theme: { dark: "gruvbox-dark-medium", light: "gruvbox-light-medium" },
  },
  {
    id: "vitesse",
    label: "Vitesse",
    description: "High-legibility coding theme with vibrant accents.",
    theme: { dark: "vitesse-dark", light: "vitesse-light" },
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Classic low-contrast palette for balanced diff scanning.",
    theme: { dark: "solarized-dark", light: "solarized-light" },
  },
];
const diffThemePreviewPatch = `diff --git a/src/components/status.ts b/src/components/status.ts
index 4c3f8d2..f3b58a1 100644
--- a/src/components/status.ts
+++ b/src/components/status.ts
@@ -1,7 +1,8 @@
 export function getStatusLabel(approved: boolean, pending: boolean) {
-  if (approved) return "Ready";
+  if (approved) return "Ready to ship";
   if (pending) return "Pending review";
+  const fallback = "Needs attention";
 
-  return "Blocked";
+  return fallback;
}
`;

const providerOptions: ProviderOption[] = [
  {
    id: "github",
    label: "GitHub",
    description:
      "Connect GitHub with one-click device auth so Rovex can clone repositories for code review.",
    repositoryHint: "Supports owner/repo or a GitHub URL. Creates a review thread automatically.",
    tokenPlaceholder: "GitHub personal access token",
  },
  {
    id: "gitlab",
    label: "GitLab",
    description:
      "Connect GitLab to clone repositories for code review, including subgroup paths.",
    repositoryHint:
      "Supports namespace/repo (including subgroups) or a GitLab URL. Creates a review thread automatically.",
    tokenPlaceholder: "GitLab personal access token",
  },
];

function providerOption(provider: ProviderKind): ProviderOption {
  const option = providerOptions.find((candidate) => candidate.id === provider);
  return option ?? providerOptions[0];
}

function getDiffThemePreset(themeId: string | null | undefined): DiffThemePreset {
  const normalized = themeId?.trim();
  if (!normalized) return diffThemePresets[0];

  const preset = diffThemePresets.find((candidate) => candidate.id === normalized);
  return preset ?? diffThemePresets[0];
}

function getInitialDiffThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_DIFF_THEME_ID;
  const storedThemeId = window.localStorage.getItem(DIFF_THEME_STORAGE_KEY);
  return getDiffThemePreset(storedThemeId).id;
}

function getInitialRepoDisplayNames(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(REPO_DISPLAY_NAME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        normalized[key] = value.trim();
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function repoNameFromWorkspace(workspace: string | null): string {
  const value = workspace?.trim();
  if (!value) return UNKNOWN_REPO;

  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSegment = normalized.split("/").pop()?.trim();
  return lastSegment && lastSegment.length > 0 ? lastSegment : value;
}

function formatRelativeAge(createdAt: string): string {
  const normalized = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  const timestamp = Number.isNaN(parsed.getTime()) ? new Date(normalized).getTime() : parsed.getTime();

  if (Number.isNaN(timestamp)) return "now";

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function groupThreadsByRepo(threads: Thread[]): RepoGroup[] {
  const groups = new Map<string, RepoReview[]>();

  for (const thread of threads) {
    const repoName = repoNameFromWorkspace(thread.workspace);
    const nextReview: RepoReview = {
      id: thread.id,
      title: thread.title,
      repoName,
      age: formatRelativeAge(thread.createdAt),
      workspace: thread.workspace,
    };
    groups.set(repoName, [...(groups.get(repoName) ?? []), nextReview]);
  }

  return [...groups.entries()].map(([repoName, reviews]) => ({ repoName, reviews }));
}

function SidebarRow(props: {
  label: string;
  right?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        as="button"
        type="button"
        onClick={props.onClick}
        isActive={props.active}
        class="group/row h-11 rounded-xl px-3.5 text-[14px] font-medium text-neutral-400 transition-all duration-150 data-[active=true]:bg-white/[0.06] data-[active=true]:text-neutral-100 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] hover:bg-white/[0.04] hover:text-neutral-200"
      >
        <div class="flex w-full items-center justify-between gap-3">
          <div class="flex min-w-0 items-center">
            <span class="truncate">{props.label}</span>
          </div>
          <Show when={props.right}>
            {(right) => (
              <kbd class="shrink-0 rounded-[5px] border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 font-sans text-[11px] text-neutral-500">
                {right()}
              </kbd>
            )}
          </Show>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

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
  const visibleThreadMessages = createMemo(() => {
    const messages = threadMessages() ?? [];
    if (messages.length <= 12) return messages;
    return messages.slice(messages.length - 12);
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

  const handleRunAiReview = async (event: Event) => {
    event.preventDefault();
    setAiReviewError(null);
    setAiStatus(null);

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
      setAiStatus(
        `AI review completed with ${response.model}${response.diffTruncated ? " (truncated diff input)." : "."}`
      );
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
          <div class="w-full p-2 md:p-3">
            <section class="glass-surface flex h-full min-h-[calc(100svh-1rem)] overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
              {/* Settings sidebar */}
              <aside class="w-[260px] shrink-0 px-3 py-5">
                <button
                  type="button"
                  class="group mb-5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
                  onClick={closeSettings}
                >
                  <ArrowLeft class="size-4 transition-transform group-hover:-translate-x-0.5" />
                  <span class="text-[14px] font-medium">Back</span>
                </button>

                <nav class="space-y-0.5">
                  <For each={settingsNavItems}>
                    {(item) => {
                      const Icon = item.icon;
                      const isActive = () => activeSettingsTab() === item.id;
                      return (
                        <button
                          type="button"
                          class={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition-all duration-150 ${isActive()
                            ? "bg-white/[0.07] font-medium text-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                            : "text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-200"
                            }`}
                          onClick={() => setActiveSettingsTab(item.id)}
                        >
                          <Icon class={`size-4 ${isActive() ? "text-amber-400/70" : "text-neutral-500"}`} />
                          <span>{item.label}</span>
                        </button>
                      );
                    }}
                  </For>
                </nav>
              </aside>

              {/* Settings content */}
              <main class="flex-1 overflow-y-auto px-8 py-8 md:px-12 md:py-10">
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
                                      placeholder="openai/gpt-4.1-mini"
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
        <Sidebar
          collapsible="offcanvas"
          class="border-0 bg-transparent group-data-[side=left]:border-r-0 group-data-[side=right]:border-l-0 [&_[data-sidebar=sidebar]]:bg-transparent"
        >
          <SidebarHeader class="px-4 pt-5 pb-2">
            <div class="flex items-center gap-2.5">
              <div class="flex size-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                <GitBranch class="size-4 text-amber-300/90" />
              </div>
              <h2 class="app-title text-[22px] text-neutral-200">Rovex</h2>
            </div>
            <Button
              type="button"
              size="sm"
              class="mt-3 h-10 w-full justify-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] font-medium text-neutral-200 hover:border-white/[0.12] hover:bg-white/[0.05]"
              disabled={providerBusy()}
              onClick={() => void handleAddLocalRepoFromSidebar()}
            >
              <FolderOpen class="size-4" />
              {providerBusy() ? "Working..." : "New Repo"}
            </Button>
          </SidebarHeader>

          <SidebarContent class="px-2.5">
            <SidebarGroup class="p-0">
              <SidebarGroupLabel class="px-3.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
                Repositories
              </SidebarGroupLabel>
              <Show when={!threads.loading} fallback={
                <div class="space-y-2 px-3.5 py-2">
                  <div class="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
                  <div class="h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
                </div>
              }>
                <Show
                  when={repoGroups().length > 0}
                  fallback={
                    <p class="px-3.5 py-3 text-[13px] text-neutral-600">
                      No reviews yet.
                    </p>
                  }
                >
                  <SidebarMenu>
                    <For each={repoGroups()}>
                      {(repo) => (
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            as="button"
                            type="button"
                            onClick={() => toggleRepoCollapsed(repo.repoName)}
                            aria-expanded={!isRepoCollapsed(repo.repoName)}
                            class="h-10 rounded-xl pl-3.5 pr-20 text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-400"
                            tooltip={repoDisplayName(repo.repoName)}
                          >
                            <div class="flex w-full items-center gap-2">
                              <ChevronRight
                                class={`size-3.5 shrink-0 text-neutral-600 transition-transform duration-150 ${
                                  isRepoCollapsed(repo.repoName) ? "" : "rotate-90 text-neutral-400"
                                }`}
                              />
                              <span class="truncate">{repoDisplayName(repo.repoName)}</span>
                            </div>
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            as="button"
                            type="button"
                            class="right-9 top-1.5 h-7 w-7 rounded-lg text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Create a new review for ${repoDisplayName(repo.repoName)}`}
                            title={`Create a new review for ${repoDisplayName(repo.repoName)}`}
                            disabled={providerBusy()}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              void handleCreateReviewForRepo(repo);
                            }}
                          >
                            <PlusCircle class="size-3.5" />
                          </SidebarMenuAction>
                          <Popover.Root
                            open={isRepoMenuOpen(repo.repoName)}
                            onOpenChange={(open) => setRepoMenuOpenState(repo.repoName, open)}
                            placement="bottom-end"
                            gutter={6}
                          >
                            <Popover.Trigger
                              as="button"
                              type="button"
                              class="absolute right-2 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-200"
                              aria-label={`Open menu for ${repoDisplayName(repo.repoName)}`}
                              title={`Open menu for ${repoDisplayName(repo.repoName)}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal class="size-3.5" />
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content
                                class="z-50 w-44 rounded-xl border border-white/[0.08] bg-[#16171b] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.45)]"
                                onClick={(event: MouseEvent) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.07]"
                                  onClick={() => handleRenameRepo(repo)}
                                >
                                  <Pencil class="size-3.5 text-neutral-400" />
                                  Edit name
                                </button>
                                <button
                                  type="button"
                                  class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
                                  onClick={() => void handleRemoveRepo(repo)}
                                >
                                  <Trash2 class="size-3.5 text-rose-300/90" />
                                  Remove
                                </button>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>
                          <Show when={!isRepoCollapsed(repo.repoName)}>
                            <SidebarMenuSub class="mt-0.5 border-white/[0.05]">
                              <For each={repo.reviews}>
                                {(review) => (
                                  <SidebarMenuSubItem>
                                    <SidebarMenuSubButton
                                      as="button"
                                      type="button"
                                      isActive={selectedThreadId() === review.id}
                                      class="h-8 w-full justify-between rounded-lg text-[13px] text-neutral-500 transition-all duration-150 data-[active=true]:bg-white/[0.06] data-[active=true]:text-neutral-200 hover:text-neutral-300"
                                      onClick={() => setSelectedThreadId(review.id)}
                                    >
                                      <span class="truncate">{review.title}</span>
                                      <span class="shrink-0 text-[11px] tabular-nums text-neutral-600">{review.age}</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )}
                              </For>
                            </SidebarMenuSub>
                          </Show>
                        </SidebarMenuItem>
                      )}
                    </For>
                  </SidebarMenu>
                </Show>
              </Show>
              <Show when={loadError()}>
                {(message) => (
                  <p class="px-3.5 pt-2 text-[12px] text-rose-400/70" title={message()}>
                    Unable to load reviews.
                  </p>
                )}
              </Show>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter class="px-2.5 pb-4">
            <SidebarSeparator class="my-2 bg-white/[0.04]" />
            <SidebarMenu>
              <SidebarRow label="Settings" onClick={() => openSettings("connections")} />
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset class="bg-transparent p-2 md:p-3">
          <section class="glass-surface flex h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            {/* Header */}
            <header class="shrink-0 border-b border-white/[0.05] px-6 py-3">
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-3 min-w-0">
                  <SidebarTrigger class="h-8 w-8 shrink-0 rounded-lg border border-white/[0.06] text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-300" />
                  <div class="min-w-0">
                    <h1 class="app-title truncate text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-100">
                      {selectedReview()?.title ?? "Select a review"}
                    </h1>
                    <Show when={selectedReview()}>
                      {(review) => (
                        <div class="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-500">
                          <span>{repoDisplayName(review().repoName)}</span>
                          <ChevronRight class="size-3 text-neutral-600" />
                          <span class="text-neutral-400">{review().age} ago</span>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-px rounded-lg border border-white/[0.06] bg-white/[0.02] text-[12px]">
                  <div class="flex items-center gap-1.5 border-r border-white/[0.06] px-3 py-1.5">
                    <span class="text-neutral-500">Base</span>
                    <span class="font-medium text-neutral-300">{compareResult()?.baseRef ?? selectedBaseRef()}</span>
                  </div>
                  <div class="flex items-center gap-1.5 border-r border-white/[0.06] px-3 py-1.5">
                    <span class="text-neutral-500">Merge</span>
                    <span class="font-mono font-medium text-neutral-300">{compareResult()?.mergeBase ? compareResult()?.mergeBase.slice(0, 8) : "—"}</span>
                  </div>
                  <div class="flex items-center gap-1.5 px-3 py-1.5">
                    <span class="text-neutral-500">Head</span>
                    <span class="font-mono font-medium text-neutral-300">{compareResult()?.head ? compareResult()?.head.slice(0, 8) : "—"}</span>
                  </div>
                </div>
              </div>
            </header>

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

              {/* Change summary bar */}
              <div class="mb-3 flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
                <span class="text-neutral-400">{compareSummary() ?? "No review loaded."}</span>
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
                    />
                  </Show>
                )}
              </Show>

              <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div class="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
                  <h3 class="text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
                    Review Notes
                  </h3>
                  <span class="text-[12px] text-neutral-600">
                    {(threadMessages() ?? []).length} messages
                  </span>
                </div>
                <Show when={threadMessagesLoadError()}>
                  {(message) => (
                    <p class="px-4 py-3 text-[13px] text-rose-300/90">
                      Unable to load thread messages: {message()}
                    </p>
                  )}
                </Show>
                <Show
                  when={visibleThreadMessages().length > 0}
                  fallback={
                    <p class="px-4 py-4 text-[13px] text-neutral-500">
                      Run AI review to populate findings on this thread.
                    </p>
                  }
                >
                  <div class="max-h-[20rem] space-y-2 overflow-y-auto px-3 py-3">
                    <For each={visibleThreadMessages()}>
                      {(message) => (
                        <div class="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
                          <div class="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                            <span>{message.role}</span>
                            <span class="text-neutral-700">•</span>
                            <span class="normal-case text-neutral-600">{formatRelativeAge(message.createdAt)} ago</span>
                          </div>
                          <p class="whitespace-pre-wrap text-[13px] leading-5 text-neutral-200">
                            {message.content}
                          </p>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Input area */}
            <footer class="shrink-0 px-6 pb-4 pt-3">
              <form
                class="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                onSubmit={(event) => void handleRunAiReview(event)}
              >
                <TextField>
                  <TextFieldInput
                    value={aiPrompt()}
                    onInput={(event) => setAiPrompt(event.currentTarget.value)}
                    placeholder="Ask AI to focus on specific risks (optional)..."
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
                      disabled={aiReviewBusy() || compareBusy() || selectedWorkspace().length === 0}
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
