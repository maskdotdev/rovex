import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
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
  type ProviderConnection,
  type Thread,
} from "@/lib/backend";
import "./App.css";

type PrimaryAction = {
  label: string;
  hint: string;
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

function TimelineRow(props: { entry: TimelineEntry }) {
  if (props.entry.kind === "edit") {
    return (
      <p class="mb-5 text-base text-slate-300">
        Edited <span class="font-semibold text-sky-300">{props.entry.file}</span>{" "}
        <span class="font-semibold text-emerald-400">{props.entry.additions}</span>{" "}
        <span class="font-semibold text-rose-400">{props.entry.deletions}</span>
      </p>
    );
  }

  const toneClass: Record<NonNullable<TimelineEntry["tone"]>, string> = {
    default: "text-slate-200",
    muted: "text-slate-400",
    strong: "font-semibold text-slate-100",
  };

  return (
    <p class={`mb-5 max-w-[86ch] text-base leading-relaxed ${toneClass[props.entry.tone ?? "default"]}`}>
      {props.entry.text}
    </p>
  );
}

function SidebarRow(props: { label: string; right?: string; active?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        class="h-12 rounded-2xl px-4 text-[15px] font-medium text-slate-100/95 data-[active=true]:bg-white/10 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(148,163,184,0.25)] hover:bg-white/8"
      >
        <div class="flex w-full items-center justify-between gap-3">
          <span class="truncate">{props.label}</span>
          <span class="shrink-0 text-[14px] text-slate-400">{props.right}</span>
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
  const repoGroups = createMemo(() => groupThreadsByRepo(threads() ?? []));
  const [selectedThreadId, setSelectedThreadId] = createSignal<number | null>(null);
  const [providerToken, setProviderToken] = createSignal("");
  const [repositoryInput, setRepositoryInput] = createSignal("");
  const [destinationRoot, setDestinationRoot] = createSignal("");
  const [providerBusy, setProviderBusy] = createSignal(false);
  const [providerError, setProviderError] = createSignal<string | null>(null);
  const [providerStatus, setProviderStatus] = createSignal<string | null>(null);

  createEffect(() => {
    const groups = repoGroups();
    if (groups.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    const selected = selectedThreadId();
    const hasSelected = groups.some((group) =>
      group.reviews.some((review) => review.id === selected)
    );
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

  const handleConnectProvider = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

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
        "--sidebar-width": "20rem",
        "--sidebar-width-icon": "3.25rem",
      }}
      class="min-h-svh"
    >
      <Sidebar
        collapsible="offcanvas"
        class="border-r border-sidebar-border/60 bg-[linear-gradient(165deg,rgba(4,8,20,0.92)_0%,rgba(2,5,14,0.98)_70%,rgba(2,8,28,0.92)_100%)]"
      >
        <SidebarHeader class="px-5 pt-4 pb-3">
          <div class="mb-4 flex items-center justify-end">
            <SidebarTrigger class="h-9 w-9 rounded-md border border-slate-300/35 text-slate-300 hover:bg-slate-700/30" />
          </div>
        </SidebarHeader>

        <SidebarContent class="px-3">
          <SidebarGroup class="p-0">
            <SidebarMenu>
              <For each={primaryActions}>
                {(action) => <SidebarRow label={action.label} right={action.hint} />}
              </For>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup class="p-0 pt-2">
            <SidebarGroupLabel class="px-4 pb-1 text-xs tracking-[0.12em] text-slate-500">
              Repositories
            </SidebarGroupLabel>
            <Show
              when={!threads.loading}
              fallback={<p class="px-4 py-2 text-sm text-slate-500">Loading reviews...</p>}
            >
              <Show
                when={repoGroups().length > 0}
                fallback={<p class="px-4 py-2 text-sm text-slate-500">No reviews yet.</p>}
              >
                <SidebarMenu>
                  <For each={repoGroups()}>
                    {(repo) => (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          class="h-11 rounded-2xl px-4 text-[14px] font-semibold uppercase tracking-[0.08em] text-slate-300 hover:bg-white/8"
                          tooltip={repo.repoName}
                        >
                          <div class="flex w-full items-center justify-between gap-3">
                            <span class="truncate">{repo.repoName}</span>
                            <span class="rounded-full border border-slate-600/70 px-2 py-0.5 text-[11px] normal-case tracking-normal text-slate-400">
                              {repo.reviews.length}
                            </span>
                          </div>
                        </SidebarMenuButton>
                        <SidebarMenuSub class="mt-1 border-slate-700/50">
                          <For each={repo.reviews}>
                            {(review) => (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  as="button"
                                  type="button"
                                  isActive={selectedThreadId() === review.id}
                                  class="h-8 w-full justify-between rounded-lg text-[13px] text-slate-300 data-[active=true]:bg-white/10 data-[active=true]:text-slate-100"
                                  onClick={() => setSelectedThreadId(review.id)}
                                >
                                  <span class="truncate">{review.title}</span>
                                  <span class="shrink-0 text-[11px] text-slate-500">
                                    {review.age}
                                  </span>
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
                <p class="px-4 pt-2 text-xs text-rose-300" title={message()}>
                  Unable to load reviews.
                </p>
              )}
            </Show>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter class="px-3 pb-4">
          <SidebarSeparator class="my-2 bg-slate-700/50" />
          <SidebarMenu>
            <SidebarRow label="Settings" />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset class="bg-transparent p-2 md:p-3">
        <section class="flex h-full min-h-[calc(100svh-1rem)] flex-col rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,15,25,0.84)_0%,rgba(7,10,18,0.95)_100%)] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          <header class="flex items-start justify-between gap-4 border-b border-slate-700/40 px-6 py-4">
            <div class="flex items-start gap-3">
              <SidebarTrigger class="mt-0.5 h-9 w-9 rounded-lg border border-slate-500/40 text-slate-200 hover:bg-slate-700/30" />
              <div>
                <h1 class="app-title text-[clamp(1.15rem,1.5vw,1.65rem)] font-semibold">
                  {selectedReview()?.title ?? "Select a review"}
                </h1>
                <p class="mt-1 text-sm text-slate-400">{selectedReview()?.repoName ?? "—"}</p>
              </div>
            </div>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" class="border-slate-600/70 text-slate-100">
                Open
              </Button>
              <Button variant="outline" size="sm" class="border-slate-600/70 text-slate-100">
                Commit
              </Button>
            </div>
          </header>

          <section class="border-b border-slate-700/40 px-6 py-4">
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              Provider Connections
            </p>
            <div class="mt-3 grid gap-4 lg:grid-cols-2">
              <div class="rounded-2xl border border-slate-600/40 bg-black/25 p-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-slate-100">GitHub</p>
                    <Show
                      when={githubConnection()}
                      fallback={<p class="mt-1 text-xs text-slate-400">Not connected</p>}
                    >
                      {(connection) => (
                        <p class="mt-1 text-xs text-slate-300">
                          Connected as{" "}
                          <span class="font-semibold text-sky-300">
                            {connection().accountLogin}
                          </span>
                        </p>
                      )}
                    </Show>
                  </div>
                  <Show when={githubConnection()}>
                    <Button
                      variant="outline"
                      size="sm"
                      class="border-slate-600/70 text-slate-100"
                      disabled={providerBusy()}
                      onClick={() => void handleDisconnectProvider()}
                    >
                      Disconnect
                    </Button>
                  </Show>
                </div>
                <Show when={!githubConnection()}>
                  <form class="mt-4" onSubmit={(event) => void handleConnectProvider(event)}>
                    <TextField>
                      <TextFieldInput
                        type="password"
                        placeholder="GitHub token"
                        value={providerToken()}
                        onInput={(event) => setProviderToken(event.currentTarget.value)}
                        class="h-11 rounded-xl border-slate-700/60 bg-black/35 text-sm text-slate-100 placeholder:text-slate-500"
                      />
                    </TextField>
                    <Button
                      type="submit"
                      size="sm"
                      class="mt-3 w-full"
                      disabled={providerBusy() || providerToken().trim().length === 0}
                    >
                      {providerBusy() ? "Connecting..." : "Connect GitHub"}
                    </Button>
                  </form>
                </Show>
              </div>

              <form
                class="rounded-2xl border border-slate-600/40 bg-black/25 p-4"
                onSubmit={(event) => void handleCloneRepository(event)}
              >
                <p class="text-sm font-semibold text-slate-100">Clone Repository</p>
                <p class="mt-1 text-xs text-slate-400">
                  Supports owner/repo or a GitHub URL. Creates a review thread after clone.
                </p>
                <TextField class="mt-3">
                  <TextFieldInput
                    placeholder="owner/repository"
                    value={repositoryInput()}
                    onInput={(event) => setRepositoryInput(event.currentTarget.value)}
                    class="h-11 rounded-xl border-slate-700/60 bg-black/35 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                </TextField>
                <TextField class="mt-3">
                  <TextFieldInput
                    placeholder="Destination root (optional)"
                    value={destinationRoot()}
                    onInput={(event) => setDestinationRoot(event.currentTarget.value)}
                    class="h-11 rounded-xl border-slate-700/60 bg-black/35 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                </TextField>
                <Button
                  type="submit"
                  size="sm"
                  class="mt-3 w-full"
                  disabled={providerBusy() || !githubConnection() || repositoryInput().trim().length === 0}
                >
                  {providerBusy() ? "Working..." : "Clone for Review"}
                </Button>
              </form>
            </div>

            <Show when={providerConnectionError()}>
              {(message) => (
                <p class="mt-3 text-xs text-rose-300" title={message()}>
                  Unable to load provider connection.
                </p>
              )}
            </Show>
            <Show when={providerError()}>
              {(message) => (
                <p class="mt-2 text-xs text-rose-300" title={message()}>
                  {message()}
                </p>
              )}
            </Show>
            <Show when={providerStatus()}>
              {(message) => (
                <p class="mt-2 text-xs text-emerald-300" title={message()}>
                  {message()}
                </p>
              )}
            </Show>
          </section>

          <div class="flex-1 overflow-y-auto px-6 py-5">
            <For each={timelineEntries}>
              {(entry) => <TimelineRow entry={entry} />}
            </For>
          </div>

          <footer class="px-6 pb-5">
            <div class="mb-3 flex items-center justify-between rounded-full border border-slate-600/40 bg-black/35 px-4 py-2 text-sm text-slate-300">
              <span>
                3 files changed <span class="font-semibold text-emerald-400">+95</span>{" "}
                <span class="font-semibold text-rose-400">-15</span>
              </span>
              <button type="button" class="text-slate-100 hover:text-white">
                Review changes ↗
              </button>
            </div>

            <form
              class="rounded-2xl border border-slate-600/40 bg-black/35 p-3"
              onSubmit={(event) => event.preventDefault()}
            >
              <TextField>
                <TextFieldInput
                  placeholder="Ask for follow-up changes"
                  class="h-12 rounded-xl border-slate-700/60 bg-black/30 text-base text-slate-100 placeholder:text-slate-500"
                />
              </TextField>
              <div class="mt-3 flex items-center gap-3 text-sm text-slate-400">
                <span class="text-xl leading-none text-slate-300">＋</span>
                <span class="text-slate-100">GPT-5.3-Codex</span>
                <span>High</span>
                <Button size="icon" variant="secondary" class="ml-auto h-9 w-9 rounded-full">
                  ●
                </Button>
              </div>
            </form>
          </footer>
        </section>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
