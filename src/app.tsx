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
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  CircleDot,
  GitBranch,
  Monitor,
  Palette,
  PlusCircle,
  PlugZap,
  Send,
  Server,
  SlidersHorizontal,
  Workflow,
} from "lucide-solid";
import { Button } from "@/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
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
  cloneRepository,
  connectProvider,
  createThread,
  disconnectProvider,
  getProviderConnection,
  listThreads,
  pollProviderDeviceAuth,
  startProviderDeviceAuth,
  type StartProviderDeviceAuthResult,
  type ProviderConnection,
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

type PrimaryAction = {
  label: string;
  hint: string;
};

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
};

type RepoGroup = {
  repoName: string;
  reviews: RepoReview[];
};

type TimelineEntry =
  | { kind: "line"; text: string; tone?: "default" | "muted" | "strong" }
  | { kind: "edit"; file: string; additions: string; deletions: string };

const primaryActions: PrimaryAction[] = [
  { label: "New thread", hint: "N" },
  { label: "Automations", hint: "A" },
  { label: "Skills", hint: "S" },
];

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

const timelineEntries: TimelineEntry[] = [
  {
    kind: "line",
    tone: "muted",
    text: "Ran bunx eslint src/middleware.ts 'src/app/(app)/layout.tsx' ...",
  },
  {
    kind: "line",
    tone: "muted",
    text: "Ran git diff -- src/middleware.ts 'src/app/(app)/layout.tsx' ...",
  },
  { kind: "line", tone: "strong", text: "Ran git status --short" },
  {
    kind: "line",
    tone: "strong",
    text: "Code changes are in place and lint passes on touched files.",
  },
  { kind: "line", tone: "muted", text: "Explored 3 files" },
  {
    kind: "line",
    text: "I spotted one edge case: stale/invalid auth cookies could still hit protected URLs.",
  },
  { kind: "edit", file: "layout.tsx", additions: "+7", deletions: "-3" },
  {
    kind: "edit",
    file: "app-layout-client.tsx",
    additions: "+18",
    deletions: "-1",
  },
  {
    kind: "line",
    tone: "muted",
    text: "Ran bunx tsc --noEmit --pretty false for 3s",
  },
  { kind: "line", tone: "muted", text: "Thinking" },
];

const UNKNOWN_REPO = "unknown-repo";

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
    };
    groups.set(repoName, [...(groups.get(repoName) ?? []), nextReview]);
  }

  return [...groups.entries()].map(([repoName, reviews]) => ({ repoName, reviews }));
}

function TimelineRow(props: { entry: TimelineEntry; index: number }) {
  if (props.entry.kind === "edit") {
    return (
      <div
        class="animate-fade-up group mb-4 flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/[0.08] hover:bg-white/[0.03]"
        style={{ "animation-delay": `${props.index * 0.04}s` }}
      >
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400/80">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Edit</title><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
        </div>
        <span class="text-[13.5px] text-neutral-300">
          <span class="font-medium text-amber-200/90">{props.entry.file}</span>
        </span>
        <div class="ml-auto flex items-center gap-2 text-[12.5px] font-medium tabular-nums">
          <span class="text-emerald-400/80">{props.entry.additions}</span>
          <span class="text-rose-400/70">{props.entry.deletions}</span>
        </div>
      </div>
    );
  }

  const toneStyles: Record<"default" | "muted" | "strong", string> = {
    default: "text-neutral-300",
    muted: "text-neutral-500",
    strong: "font-medium text-neutral-200",
  };

  const tone = props.entry.tone ?? "default";

  return (
    <div
      class="animate-fade-up mb-4 flex gap-3"
      style={{ "animation-delay": `${props.index * 0.04}s` }}
    >
      <div class="mt-[7px] flex shrink-0">
        <span
          class={`block h-1.5 w-1.5 rounded-full ${
            tone === "strong" ? "bg-amber-400/60" : tone === "muted" ? "bg-neutral-600" : "bg-neutral-500"
          }`}
        />
      </div>
      <p class={`max-w-[82ch] text-[14px] leading-[1.7] ${toneStyles[tone]}`}>
        {props.entry.text}
      </p>
    </div>
  );
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

  const [activeView, setActiveView] = createSignal<AppView>("workspace");
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTab>("connections");

  const repoGroups = createMemo(() => groupThreadsByRepo(threads() ?? []));
  const [selectedThreadId, setSelectedThreadId] = createSignal<number | null>(null);
  const [providerToken, setProviderToken] = createSignal("");
  const [repositoryInput, setRepositoryInput] = createSignal("");
  const [destinationRoot, setDestinationRoot] = createSignal("");
  const [providerBusy, setProviderBusy] = createSignal(false);
  const [providerError, setProviderError] = createSignal<string | null>(null);
  const [providerStatus, setProviderStatus] = createSignal<string | null>(null);
  const [deviceAuthInProgress, setDeviceAuthInProgress] = createSignal(false);
  const [deviceAuthUserCode, setDeviceAuthUserCode] = createSignal<string | null>(null);
  const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] = createSignal<string | null>(null);
  let deviceAuthSession = 0;

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
    const error = githubConnection.error;
    if (!error) return null;
    return error instanceof Error ? error.message : String(error);
  });

  const clearProviderNotice = () => {
    setProviderError(null);
    setProviderStatus(null);
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

  const openDeviceVerificationUrl = async () => {
    const url = deviceAuthVerificationUrl();
    if (!url) return;

    try {
      await openUrl(url);
    } catch (error) {
      setProviderError(
        error instanceof Error ? error.message : "Failed to open GitHub verification URL."
      );
    }
  };

  const pollGitHubDeviceAuth = async (
    sessionId: number,
    flow: StartProviderDeviceAuthResult
  ) => {
    let intervalMs = Math.max(1, flow.interval) * 1000;
    const expiresAt = Date.now() + Math.max(1, flow.expiresIn) * 1000;

    while (sessionId === deviceAuthSession && Date.now() < expiresAt) {
      await sleep(intervalMs);
      if (sessionId !== deviceAuthSession) {
        return;
      }

      try {
        const result = await pollProviderDeviceAuth({
          provider: "github",
          deviceCode: flow.deviceCode,
        });
        if (sessionId !== deviceAuthSession) {
          return;
        }

        if (result.status === "complete" && result.connection) {
          await refetchGithubConnection();
          cancelDeviceAuthFlow();
          setProviderStatus(`Connected GitHub as ${result.connection.accountLogin}.`);
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
    setProviderError("GitHub sign-in timed out. Start again.");
  };

  const handleStartDeviceAuth = async () => {
    clearProviderNotice();
    cancelDeviceAuthFlow();
    const sessionId = deviceAuthSession;

    setProviderBusy(true);
    try {
      const flow = await startProviderDeviceAuth({ provider: "github" });
      const verificationUrl = flow.verificationUriComplete ?? flow.verificationUri;

      setDeviceAuthInProgress(true);
      setDeviceAuthUserCode(flow.userCode);
      setDeviceAuthVerificationUrl(verificationUrl);
      setProviderStatus(`Enter code ${flow.userCode} in GitHub to finish connecting.`);

      await openDeviceVerificationUrl();
      void pollGitHubDeviceAuth(sessionId, flow);
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
    event.preventDefault();
    clearProviderNotice();
    cancelDeviceAuthFlow();

    const token = providerToken().trim();
    if (!token) {
      setProviderError("Enter a GitHub personal access token.");
      return;
    }

    setProviderBusy(true);
    try {
      const connection = await connectProvider({ provider: "github", accessToken: token });
      setProviderToken("");
      await refetchGithubConnection();
      setProviderStatus(`Connected GitHub as ${connection.accountLogin}.`);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleDisconnectProvider = async () => {
    clearProviderNotice();
    cancelDeviceAuthFlow();
    setProviderBusy(true);
    try {
      await disconnectProvider("github");
      await refetchGithubConnection();
      setProviderStatus("Disconnected GitHub.");
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  };

  const handleCloneRepository = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

    const repository = repositoryInput().trim();
    if (!repository) {
      setProviderError("Enter a repository (owner/repo or GitHub URL).");
      return;
    }

    setProviderBusy(true);
    try {
      const cloneResult = await cloneRepository({
        provider: "github",
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
                          class={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition-all duration-150 ${
                            isActive()
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
                    <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                      <p class="text-[15px] font-medium text-neutral-200">{selectedSettingsItem().label}</p>
                      <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                        This section is ready for settings controls. Select Connections to manage GitHub.
                      </p>
                    </section>
                  }
                >
                  <div class="mt-10 max-w-3xl space-y-5">
                    {/* GitHub connection card */}
                    <section class="animate-fade-up overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02]" style={{ "animation-delay": "0.08s" }}>
                      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.04] px-6 py-5">
                        <div>
                          <div class="flex items-center gap-2.5">
                            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-neutral-300"><title>GitHub</title>
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                              </svg>
                            </div>
                            <p class="text-[15px] font-medium text-neutral-100">GitHub</p>
                          </div>
                          <p class="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
                            Connect GitHub with one-click device auth so Rovex can clone repositories for code review.
                          </p>
                        </div>
                        <span
                          class={`mt-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${
                            githubConnection()
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                              : "border-white/[0.06] bg-white/[0.03] text-neutral-500"
                          }`}
                        >
                          {githubConnection() ? "Connected" : "Not connected"}
                        </span>
                      </div>

                      <div class="px-6 py-5">
                        <Show
                          when={githubConnection()}
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
                                    : "Connect with GitHub"}
                              </Button>
                              <Show when={deviceAuthInProgress() && deviceAuthUserCode()}>
                                {(userCode) => (
                                  <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200/90">
                                    Enter code <span class="font-semibold tracking-[0.08em]">{userCode()}</span> on GitHub.
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      class="mt-3 border-white/[0.1] text-neutral-200 hover:border-white/[0.18]"
                                      onClick={() => void openDeviceVerificationUrl()}
                                    >
                                      Open GitHub verification
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
                                      placeholder="GitHub personal access token"
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
                        Supports owner/repo or a GitHub URL. Creates a review thread automatically.
                      </p>

                      <TextField class="mt-4 max-w-md">
                        <TextFieldInput
                          placeholder="owner/repository"
                          value={repositoryInput()}
                          onInput={(event) => setRepositoryInput(event.currentTarget.value)}
                          class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                        />
                      </TextField>

                      <TextField class="mt-3 max-w-md">
                        <TextFieldInput
                          placeholder="Destination root (optional)"
                          value={destinationRoot()}
                          onInput={(event) => setDestinationRoot(event.currentTarget.value)}
                          class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                        />
                      </TextField>

                      <Button
                        type="submit"
                        size="sm"
                        class="mt-4"
                        disabled={providerBusy() || !githubConnection() || repositoryInput().trim().length === 0}
                      >
                        {providerBusy() ? "Working..." : "Clone for review"}
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
            <div class="mb-3 flex items-center">
              <h2 class="app-title text-[22px] text-neutral-200">Rovex</h2>
            </div>
          </SidebarHeader>

          <SidebarContent class="px-2.5">
            <SidebarGroup class="p-0">
              <SidebarMenu>
                <For each={primaryActions}>
                  {(action) => <SidebarRow label={action.label} right={action.hint} />}
                </For>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup class="p-0 pt-3">
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
                            class="h-10 rounded-xl px-3.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-400"
                            tooltip={repo.repoName}
                          >
                            <div class="flex w-full items-center justify-between gap-3">
                              <span class="truncate">{repo.repoName}</span>
                              <span class="rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-neutral-600">
                                {repo.reviews.length}
                              </span>
                            </div>
                          </SidebarMenuButton>
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
          <section class="glass-surface flex h-full min-h-[calc(100svh-1rem)] flex-col rounded-2xl border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            {/* Header */}
            <header class="flex items-center justify-between gap-4 border-b border-white/[0.05] px-6 py-4">
              <div class="flex items-center gap-3">
                <SidebarTrigger class="h-8 w-8 rounded-lg border border-white/[0.06] text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-300" />
                <div>
                  <h1 class="app-title text-[clamp(1.25rem,1.6vw,1.75rem)] text-neutral-100">
                    {selectedReview()?.title ?? "Select a review"}
                  </h1>
                  <Show when={selectedReview()}>
                    <div class="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-neutral-500">
                      <span>{selectedReview()?.repoName}</span>
                      <ChevronRight class="size-3 text-neutral-600" />
                      <span class="text-neutral-400">{selectedReview()?.age} ago</span>
                    </div>
                  </Show>
                </div>
              </div>
              <div class="flex gap-2">
                <Button variant="outline" size="sm" class="border-white/[0.08] text-[13px] font-medium text-neutral-300 hover:border-white/[0.12] hover:text-neutral-100">
                  Open
                </Button>
                <Button variant="outline" size="sm" class="border-white/[0.08] text-[13px] font-medium text-neutral-300 hover:border-white/[0.12] hover:text-neutral-100">
                  Commit
                </Button>
              </div>
            </header>

            {/* Timeline */}
            <div class="flex-1 overflow-y-auto px-7 py-6">
              <For each={timelineEntries}>
                {(entry, index) => <TimelineRow entry={entry} index={index()} />}
              </For>
            </div>

            {/* Footer */}
            <footer class="px-6 pb-5">
              {/* Change summary bar */}
              <div class="mb-3 flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
                <span class="text-neutral-400">
                  3 files changed{" "}
                  <span class="font-medium tabular-nums text-emerald-400/80">+95</span>{" "}
                  <span class="font-medium tabular-nums text-rose-400/70">-15</span>
                </span>
                <button type="button" class="flex items-center gap-1 font-medium text-amber-400/80 transition-colors hover:text-amber-300">
                  Review changes
                  <ChevronRight class="size-3.5" />
                </button>
              </div>

              {/* Input area */}
              <form
                class="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                onSubmit={(event) => event.preventDefault()}
              >
                <TextField>
                  <TextFieldInput
                    placeholder="Ask for follow-up changes..."
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
                  <Button size="icon" class="h-8 w-8 rounded-xl bg-amber-500/90 text-neutral-900 shadow-[0_0_12px_rgba(212,175,55,0.15)] hover:bg-amber-400/90">
                    <Send class="size-3.5" />
                  </Button>
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
