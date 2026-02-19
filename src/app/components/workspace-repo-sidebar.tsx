import { For, Show, createMemo, createSignal, type Accessor } from "solid-js";
import {
  Check,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleUser,
  ExternalLink,
  FolderOpen,
  Gauge,
  GitBranch,
  LogOut,
  MoreHorizontal,
  Pencil,
  PlusCircle,
  Settings,
  Trash2,
} from "lucide-solid";
import * as Dialog from "@kobalte/core/dialog";
import * as Popover from "@kobalte/core/popover";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/sidebar";
import type { RepoGroup, RepoReview, RepoReviewDefaults } from "@/app/types";
import { listWorkspaceBranches, type AppServerAccountStatus } from "@/lib/backend";

type WorkspaceRepoSidebarProps = {
  providerBusy: Accessor<boolean>;
  onAddLocalRepo: () => void | Promise<void>;
  threadsLoading: Accessor<boolean>;
  repoGroups: Accessor<RepoGroup[]>;
  loadError: Accessor<string | null>;
  repoDisplayName: (repoName: string) => string;
  isRepoCollapsed: (repoName: string) => boolean;
  toggleRepoCollapsed: (repoName: string) => void;
  selectedThreadId: Accessor<number | null>;
  onSelectThread: (threadId: number) => void;
  onCreateReviewForRepo: (
    repo: RepoGroup,
    draft?: Partial<RepoReviewDefaults>
  ) => Promise<boolean>;
  selectedBaseRef: Accessor<string>;
  reviewDefaultsByRepo: Accessor<Record<string, RepoReviewDefaults>>;
  isRepoMenuOpen: (repoName: string) => boolean;
  setRepoMenuOpenState: (repoName: string, open: boolean) => void;
  onRenameRepo: (repo: RepoGroup) => void;
  onRemoveRepo: (repo: RepoGroup) => void | Promise<void>;
  onRemoveReview: (repo: RepoGroup, review: RepoReview) => void | Promise<void>;
  onOpenSettings: () => void;
  onSwitchAccount?: () => void | Promise<void>;
  appServerAccountStatus: Accessor<AppServerAccountStatus | undefined>;
  appServerAccountLoadError: Accessor<string | null>;
  maskAccountEmail: Accessor<boolean>;
};

export function WorkspaceRepoSidebar(props: WorkspaceRepoSidebarProps) {
  const formatQuotaResetTime = (unixSeconds: number | null | undefined) => {
    if (!unixSeconds || unixSeconds <= 0) {
      return "Unknown";
    }
    const date = new Date(unixSeconds * 1000);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatQuotaResetDate = (unixSeconds: number | null | undefined) => {
    if (!unixSeconds || unixSeconds <= 0) {
      return "Unknown";
    }
    const date = new Date(unixSeconds * 1000);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const accountEmailLabel = createMemo(() => {
    const email = props.appServerAccountStatus()?.email?.trim();
    if (!email) {
      return "Not signed in";
    }
    if (props.maskAccountEmail()) {
      return "Hidden";
    }
    return email;
  });

  const accountTypeLabel = createMemo(() => {
    const rawType = props.appServerAccountStatus()?.accountType?.trim() ?? "";
    if (!rawType) {
      return "Personal account";
    }
    return `${rawType[0].toUpperCase()}${rawType.slice(1)} account`;
  });

  const usageWindows = createMemo(() => {
    const rateLimits = props.appServerAccountStatus()?.rateLimits;
    const primary = rateLimits?.primary ?? null;
    const secondary = rateLimits?.secondary ?? null;
    const windows = [primary, secondary].filter((value): value is NonNullable<typeof value> => Boolean(value));

    const fiveHourWindow =
      windows.find((window) => window.windowDurationMins === 300) ?? primary ?? secondary;
    const weeklyWindow =
      windows.find((window) => window.windowDurationMins === 10080) ??
      (fiveHourWindow === primary ? secondary : primary);

    return {
      fiveHourWindow,
      weeklyWindow,
    };
  });

  const clampPercent = (value: number | null | undefined) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  };

  const usageTone = (leftPercent: number) => {
    if (leftPercent >= 30) {
      return {
        barClass: "bg-emerald-400/80",
        textClass: "text-emerald-300",
      };
    }
    if (leftPercent >= 10) {
      return {
        barClass: "bg-amber-400/80",
        textClass: "text-amber-300",
      };
    }
    return {
      barClass: "bg-rose-400/80",
      textClass: "text-rose-300",
    };
  };

  const [reviewSheetOpen, setReviewSheetOpen] = createSignal(false);
  const [reviewDraftRepo, setReviewDraftRepo] = createSignal<RepoGroup | null>(null);
  const [reviewBranchInput, setReviewBranchInput] = createSignal("");
  const [reviewBaseRefInput, setReviewBaseRefInput] = createSignal("");
  const [reviewCurrentBranch, setReviewCurrentBranch] = createSignal<string | null>(null);
  const [reviewBranchSuggestions, setReviewBranchSuggestions] = createSignal<string[]>([]);
  const [reviewBranchComboboxOpen, setReviewBranchComboboxOpen] = createSignal(false);
  const [reviewBaseRefSuggestions, setReviewBaseRefSuggestions] = createSignal<string[]>([]);
  const [reviewBaseRefSuggested, setReviewBaseRefSuggested] = createSignal<string | null>(null);
  const [reviewBaseRefLoading, setReviewBaseRefLoading] = createSignal(false);
  const [reviewBaseRefLoadError, setReviewBaseRefLoadError] = createSignal<string | null>(null);
  const [reviewBaseRefComboboxOpen, setReviewBaseRefComboboxOpen] = createSignal(false);
  const [reviewDraftError, setReviewDraftError] = createSignal<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
  const [rateLimitsExpanded, setRateLimitsExpanded] = createSignal(true);
  let reviewBaseRefLoadRequestId = 0;

  const defaultBaseRefTargets = ["origin/main", "origin/master", "main", "master", "HEAD~1"];

  const dedupeRefTargets = (values: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    const targets: string[] = [];
    for (const rawValue of values) {
      const value = rawValue?.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(value);
    }
    return targets;
  };

  const filteredReviewBaseRefSuggestions = createMemo(() => {
    const query = reviewBaseRefInput().trim().toLowerCase();
    const targets = reviewBaseRefSuggestions();
    if (!query) return targets;
    return targets.filter((target) => target.toLowerCase().includes(query));
  });

  const filteredReviewBranchSuggestions = createMemo(() => {
    const query = reviewBranchInput().trim().toLowerCase();
    const targets = reviewBranchSuggestions();
    if (!query) return targets;
    return targets.filter((target) => target.toLowerCase().includes(query));
  });

  const reviewBranchTypedTarget = createMemo(() => {
    const typedValue = reviewBranchInput().trim();
    if (!typedValue) return null;
    const alreadyListed = reviewBranchSuggestions().some(
      (target) => target.toLowerCase() === typedValue.toLowerCase()
    );
    return alreadyListed ? null : typedValue;
  });

  const reviewBaseRefTypedTarget = createMemo(() => {
    const typedValue = reviewBaseRefInput().trim();
    if (!typedValue) return null;
    const alreadyListed = reviewBaseRefSuggestions().some(
      (target) => target.toLowerCase() === typedValue.toLowerCase()
    );
    return alreadyListed ? null : typedValue;
  });

  const activeReviewDefaults = createMemo<RepoReviewDefaults | null>(() => {
    const repo = reviewDraftRepo();
    if (!repo) return null;
    return props.reviewDefaultsByRepo()[repo.repoName] ?? null;
  });

  const reviewSheetRepoLabel = createMemo(() => {
    const repo = reviewDraftRepo();
    if (!repo) return "repository";
    return props.repoDisplayName(repo.repoName);
  });

  const loadReviewBaseRefSuggestions = async (
    repo: RepoGroup,
    fallbackBaseRef: string,
    adoptSuggestedBaseRef: boolean,
    fallbackReviewBranch: string,
    adoptCurrentBranch: boolean
  ) => {
    const requestId = ++reviewBaseRefLoadRequestId;
    setReviewBaseRefLoading(true);
    setReviewBaseRefLoadError(null);

    const workspace =
      repo.workspace?.trim() ||
      repo.reviews.find((review) => review.workspace?.trim())?.workspace?.trim() ||
      null;

    if (!workspace) {
      setReviewCurrentBranch(null);
      const branchTargets = dedupeRefTargets([fallbackReviewBranch]);
      setReviewBranchSuggestions(branchTargets);
      const fallbackTargets = dedupeRefTargets([fallbackBaseRef, ...defaultBaseRefTargets]);
      setReviewBaseRefSuggestions(fallbackTargets);
      setReviewBaseRefSuggested(fallbackTargets[0] ?? "origin/main");
      if (adoptCurrentBranch && branchTargets[0]) {
        setReviewBranchInput(branchTargets[0]);
      }
      if (adoptSuggestedBaseRef && fallbackTargets[0]) {
        setReviewBaseRefInput(fallbackTargets[0]);
      }
      setReviewBaseRefLoading(false);
      return;
    }

    try {
      const result = await listWorkspaceBranches({
        workspace,
        fetchRemote: true,
      });
      if (requestId !== reviewBaseRefLoadRequestId) return;

      const currentBranch = result.currentBranch?.trim() || null;
      setReviewCurrentBranch(currentBranch);
      const remoteTargets = result.remoteBranches.map((branch) => branch.name);
      const localTargets = result.branches.map((branch) => branch.name);
      const branchTargets = dedupeRefTargets([currentBranch, fallbackReviewBranch, ...localTargets]);
      const targets = dedupeRefTargets([
        result.suggestedBaseRef,
        result.upstreamBranch,
        fallbackBaseRef,
        ...defaultBaseRefTargets,
        ...remoteTargets,
        ...localTargets,
      ]);
      const suggestedBaseRef = result.suggestedBaseRef?.trim() || targets[0] || "origin/main";
      setReviewBranchSuggestions(branchTargets);
      setReviewBaseRefSuggestions(targets);
      setReviewBaseRefSuggested(suggestedBaseRef);
      if (adoptCurrentBranch && currentBranch && reviewBranchInput().trim().length === 0) {
        setReviewBranchInput(currentBranch);
      }
      if (adoptSuggestedBaseRef) {
        setReviewBaseRefInput(suggestedBaseRef);
      }
    } catch (error) {
      if (requestId !== reviewBaseRefLoadRequestId) return;
      setReviewCurrentBranch(null);
      const branchTargets = dedupeRefTargets([fallbackReviewBranch]);
      setReviewBranchSuggestions(branchTargets);
      const fallbackTargets = dedupeRefTargets([fallbackBaseRef, ...defaultBaseRefTargets]);
      setReviewBaseRefSuggestions(fallbackTargets);
      setReviewBaseRefSuggested(fallbackTargets[0] ?? "origin/main");
      setReviewBaseRefLoadError(error instanceof Error ? error.message : String(error));
      if (adoptCurrentBranch && branchTargets[0]) {
        setReviewBranchInput(branchTargets[0]);
      }
      if (adoptSuggestedBaseRef && fallbackTargets[0]) {
        setReviewBaseRefInput(fallbackTargets[0]);
      }
    } finally {
      if (requestId === reviewBaseRefLoadRequestId) {
        setReviewBaseRefLoading(false);
      }
    }
  };

  const openCreateReviewSheet = (repo: RepoGroup) => {
    const defaults = props.reviewDefaultsByRepo()[repo.repoName];
    const selectedBaseRef = props.selectedBaseRef().trim();
    const savedBaseRef = defaults?.baseRef?.trim() || "";
    const savedReviewBranch = defaults?.reviewBranch?.trim() || "";
    const fallbackBaseRef = savedBaseRef || selectedBaseRef || "origin/main";
    const fallbackReviewBranch = savedReviewBranch;
    const shouldAdoptCurrentBranch = !savedReviewBranch;
    const shouldAdoptSuggestedBaseRef =
      !savedBaseRef &&
      (selectedBaseRef.length === 0 ||
        selectedBaseRef.toLowerCase() === "main" ||
        selectedBaseRef.toLowerCase() === "origin/main");

    setReviewDraftRepo(repo);
    setReviewBranchInput(fallbackReviewBranch);
    setReviewBranchSuggestions(dedupeRefTargets([fallbackReviewBranch]));
    setReviewBranchComboboxOpen(false);
    setReviewBaseRefInput(fallbackBaseRef);
    setReviewBaseRefSuggestions(dedupeRefTargets([fallbackBaseRef, ...defaultBaseRefTargets]));
    setReviewBaseRefSuggested(fallbackBaseRef);
    setReviewBaseRefComboboxOpen(false);
    setReviewBaseRefLoadError(null);
    setReviewDraftError(null);
    setReviewSheetOpen(true);
    void loadReviewBaseRefSuggestions(
      repo,
      fallbackBaseRef,
      shouldAdoptSuggestedBaseRef,
      fallbackReviewBranch,
      shouldAdoptCurrentBranch
    );
  };

  const closeCreateReviewSheet = () => {
    reviewBaseRefLoadRequestId += 1;
    setReviewSheetOpen(false);
    setReviewCurrentBranch(null);
    setReviewBranchInput("");
    setReviewBranchSuggestions([]);
    setReviewBranchComboboxOpen(false);
    setReviewBaseRefComboboxOpen(false);
    setReviewBaseRefLoadError(null);
    setReviewDraftError(null);
  };

  const handleCreateReviewFromSheet = async () => {
    const repo = reviewDraftRepo();
    if (!repo) return;

    const baseRef = reviewBaseRefInput().trim();
    if (!baseRef) {
      setReviewDraftError("Against what is required.");
      return;
    }

    const reviewBranch = reviewBranchInput().trim() || reviewCurrentBranch()?.trim() || "";

    setReviewDraftError(null);
    const success = await props.onCreateReviewForRepo(repo, {
      baseRef,
      reviewBranch: reviewBranch || undefined,
    });
    if (success) {
      closeCreateReviewSheet();
    } else {
      setReviewDraftError("Unable to create review. Check provider status for details.");
    }
  };

  const handleQuickReviewFromSheet = async () => {
    const repo = reviewDraftRepo();
    const defaults = activeReviewDefaults();
    if (!repo || !defaults) return;

    setReviewDraftError(null);
    const success = await props.onCreateReviewForRepo(repo, defaults);
    if (success) {
      closeCreateReviewSheet();
    } else {
      setReviewDraftError("Unable to create review. Check provider status for details.");
    }
  };

  const handleOpenRateLimitsDocs = async () => {
    try {
      await openUrl("https://platform.openai.com/docs/guides/rate-limits");
    } catch {
      // Ignore opener errors; the UI action should stay non-blocking.
    }
  };

  const handleOpenSettingsFromMenu = () => {
    setAccountMenuOpen(false);
    props.onOpenSettings();
  };

  const handleSwitchAccountFromMenu = async () => {
    setAccountMenuOpen(false);
    if (props.onSwitchAccount) {
      await props.onSwitchAccount();
      return;
    }
    props.onOpenSettings();
  };

  return (
    <>
      <Sidebar
        collapsible="offcanvas"
        class="border-0 bg-transparent group-data-[side=left]:border-r-0 group-data-[side=right]:border-l-0 [&_[data-sidebar=sidebar]]:bg-transparent"
      >
        <SidebarHeader class="px-4 pb-2 pt-5">
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
          disabled={props.providerBusy()}
          onClick={() => void props.onAddLocalRepo()}
        >
          <FolderOpen class="size-4" />
          {props.providerBusy() ? "Working..." : "New Repo"}
        </Button>
      </SidebarHeader>

      <SidebarContent class="px-2.5">
        <SidebarGroup class="p-0">
          <SidebarGroupLabel class="px-3.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
            Repositories
          </SidebarGroupLabel>
          <Show
            when={!props.threadsLoading()}
            fallback={
              <div class="space-y-2 px-3.5 py-2">
                <div class="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
                <div class="h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
              </div>
            }
          >
            <Show
              when={props.repoGroups().length > 0}
              fallback={
                <p class="px-3.5 py-3 text-[13px] text-neutral-600">
                  No reviews yet.
                </p>
              }
            >
              <SidebarMenu>
                <For each={props.repoGroups()}>
                  {(repo) => (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        as="button"
                        type="button"
                        onClick={() => props.toggleRepoCollapsed(repo.repoName)}
                        aria-expanded={!props.isRepoCollapsed(repo.repoName)}
                        class="h-10 rounded-xl pl-3.5 pr-20 text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-400"
                        tooltip={props.repoDisplayName(repo.repoName)}
                      >
                        <div class="flex w-full items-center gap-2">
                          <ChevronRight
                            class={`size-3.5 shrink-0 text-neutral-600 transition-transform duration-150 ${
                              props.isRepoCollapsed(repo.repoName) ? "" : "rotate-90 text-neutral-400"
                            }`}
                          />
                          <span class="truncate">{props.repoDisplayName(repo.repoName)}</span>
                        </div>
                      </SidebarMenuButton>
                        <SidebarMenuAction
                          as="button"
                          type="button"
                          class="right-9 top-1.5 h-7 w-7 rounded-lg text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Create a new review for ${props.repoDisplayName(repo.repoName)}`}
                          title={`Create a new review for ${props.repoDisplayName(repo.repoName)}`}
                          disabled={props.providerBusy()}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            openCreateReviewSheet(repo);
                          }}
                        >
                          <PlusCircle class="size-3.5" />
                        </SidebarMenuAction>
                      <Popover.Root
                        open={props.isRepoMenuOpen(repo.repoName)}
                        onOpenChange={(open) => props.setRepoMenuOpenState(repo.repoName, open)}
                        placement="bottom-end"
                        gutter={6}
                      >
                        <Popover.Trigger
                          as="button"
                          type="button"
                          class="absolute right-2 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 outline-none ring-sidebar-ring transition-colors hover:bg-white/[0.08] hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2"
                          aria-label={`Open menu for ${props.repoDisplayName(repo.repoName)}`}
                          title={`Open menu for ${props.repoDisplayName(repo.repoName)}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal class="size-3.5" />
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            class="z-50 w-44 rounded-xl border border-white/[0.08] bg-[#16171b] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.45)] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                            onClick={(event: MouseEvent) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.07]"
                              onClick={() => props.onRenameRepo(repo)}
                            >
                              <Pencil class="size-3.5 text-neutral-400" />
                              Edit name
                            </button>
                            <button
                              type="button"
                              class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
                              onClick={() => void props.onRemoveRepo(repo)}
                            >
                              <Trash2 class="size-3.5 text-rose-300/90" />
                              Remove
                            </button>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                      <Show when={!props.isRepoCollapsed(repo.repoName)}>
                        <SidebarMenuSub class="mt-0.5 border-white/[0.05] pr-0">
                          <For each={repo.reviews}>
                            {(review) => (
                              <SidebarMenuSubItem class="group/review-item relative">
                                <SidebarMenuSubButton
                                  as="button"
                                  type="button"
                                  isActive={props.selectedThreadId() === review.id}
                                  class="h-8 w-full justify-between rounded-lg text-[13px] text-neutral-500 transition-all duration-150 data-[active=true]:bg-white/[0.06] data-[active=true]:text-neutral-200 hover:text-neutral-300"
                                  onClick={() => props.onSelectThread(review.id)}
                                >
                                  <span class="truncate pr-2">{review.title}</span>
                                  <span class="shrink-0 text-[11px] tabular-nums text-neutral-600 transition-opacity duration-150 group-hover/review-item:opacity-0 group-focus-within/review-item:opacity-0">
                                    {review.age}
                                  </span>
                                </SidebarMenuSubButton>
                                <button
                                  type="button"
                                  class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-600 opacity-0 transition-all pointer-events-none group-hover/review-item:pointer-events-auto group-hover/review-item:opacity-100 group-focus-within/review-item:pointer-events-auto group-focus-within/review-item:opacity-100 hover:bg-rose-500/10 hover:text-rose-300"
                                  aria-label={`Remove review ${review.title}`}
                                  title={`Remove review ${review.title}`}
                                  disabled={props.providerBusy()}
                                  onClick={(event: MouseEvent) => {
                                    event.stopPropagation();
                                    void props.onRemoveReview(repo, review);
                                  }}
                                >
                                  <Trash2 class="size-3.5" />
                                </button>
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
          <Show when={props.loadError()}>
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
        <Popover.Root
          open={accountMenuOpen()}
          onOpenChange={setAccountMenuOpen}
          placement="right-start"
          gutter={10}
        >
          <Popover.Trigger
            as="button"
            type="button"
            class="group flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-neutral-300 outline-none ring-sidebar-ring transition-colors hover:bg-white/[0.05] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2"
          >
            <Settings class="size-4 text-neutral-500 transition-colors group-hover:text-neutral-300" />
            <span class="text-[14px] font-medium">Settings</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-50 w-[320px] rounded-[18px] border border-white/[0.08] bg-[linear-gradient(156deg,rgba(24,25,30,0.98)_0%,rgba(16,17,21,0.98)_100%)] p-3 shadow-[0_24px_64px_rgba(0,0,0,0.52)] backdrop-blur-xl outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0">
              <div class="flex items-center gap-2 px-1.5 py-0.5">
                <CircleUser class="size-4 text-neutral-500" />
                <p class="truncate text-[13.5px] font-medium text-neutral-300">{accountEmailLabel()}</p>
              </div>
              <div class="mt-0.5 flex items-center gap-2 px-1.5 py-0.5">
                <BadgeCheck class="size-4 text-neutral-500" />
                <p class="text-[13.5px] text-neutral-400">{accountTypeLabel()}</p>
              </div>
              <div class="mt-0.5 px-1.5 text-[11.5px] text-neutral-500">
                Plan: <span class="font-medium text-neutral-300">{props.appServerAccountStatus()?.planType ?? "Unknown"}</span>
              </div>

              <div class="my-2 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-neutral-100 transition-colors hover:bg-white/[0.06]"
                onClick={handleOpenSettingsFromMenu}
              >
                <Settings class="size-4 text-neutral-400" />
                <span class="text-[13.5px] font-medium">Settings</span>
              </button>

              <div class="my-2 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-9 w-full items-center justify-between rounded-lg px-2 text-left text-neutral-100 transition-colors hover:bg-white/[0.05]"
                onClick={() => setRateLimitsExpanded((open) => !open)}
              >
                <div class="flex items-center gap-2">
                  <Gauge class="size-4 text-neutral-300" />
                  <span class="text-[13.5px] font-medium">Rate limits remaining</span>
                </div>
                <ChevronDown
                  class={`size-4 text-neutral-500 transition-transform ${rateLimitsExpanded() ? "rotate-180" : ""}`}
                />
              </button>

              <Show when={rateLimitsExpanded()}>
                <div class="mt-1.5 space-y-2">
                  <p class="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Codex usage
                  </p>
                  <Show when={usageWindows().fiveHourWindow}>
                    {(window) => {
                      const used = clampPercent(window().usedPercent);
                      const left = clampPercent(100 - used);
                      const tone = usageTone(left);
                      return (
                        <div class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
                          <div class="flex items-baseline justify-between gap-2">
                            <p class="text-[12.5px] font-semibold text-neutral-200">Primary (5h)</p>
                            <p class={`text-[12px] font-medium tabular-nums ${tone.textClass}`}>{left}% left</p>
                          </div>
                          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                            <div
                              class={`h-full rounded-full transition-[width] duration-300 ${tone.barClass}`}
                              style={{ width: `${used}%` }}
                            />
                          </div>
                          <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                            <p class="tabular-nums">{used}% used / {left}% left</p>
                            <p class="tabular-nums">resets {formatQuotaResetTime(window().resetsAt)}</p>
                          </div>
                        </div>
                      );
                    }}
                  </Show>
                  <Show when={usageWindows().weeklyWindow}>
                    {(window) => {
                      const used = clampPercent(window().usedPercent);
                      const left = clampPercent(100 - used);
                      const tone = usageTone(left);
                      return (
                        <div class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
                          <div class="flex items-baseline justify-between gap-2">
                            <p class="text-[12.5px] font-semibold text-neutral-200">Secondary (Weekly)</p>
                            <p class={`text-[12px] font-medium tabular-nums ${tone.textClass}`}>{left}% left</p>
                          </div>
                          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                            <div
                              class={`h-full rounded-full transition-[width] duration-300 ${tone.barClass}`}
                              style={{ width: `${used}%` }}
                            />
                          </div>
                          <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                            <p class="tabular-nums">{used}% used / {left}% left</p>
                            <p class="tabular-nums">resets {formatQuotaResetDate(window().resetsAt)}</p>
                          </div>
                        </div>
                      );
                    }}
                  </Show>
                  <Show when={props.appServerAccountStatus()?.detail}>
                    {(detail) => (
                      <p class="px-2 text-[11px] leading-relaxed text-neutral-500">{detail()}</p>
                    )}
                  </Show>
                  <button
                    type="button"
                    class="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                    onClick={() => void handleOpenRateLimitsDocs()}
                  >
                    <span class="text-[13px] font-medium">Learn more</span>
                    <ExternalLink class="size-3.5 text-neutral-500" />
                  </button>
                </div>
              </Show>

              <div class="my-2 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-neutral-100 transition-colors hover:bg-white/[0.05]"
                onClick={() => void handleSwitchAccountFromMenu()}
              >
                <LogOut class="size-4 text-neutral-400" />
                <span class="text-[13.5px] font-medium">Log out</span>
              </button>

              <Show when={props.appServerAccountLoadError()}>
                {(error) => (
                  <p class="mt-1.5 px-2 text-[11px] text-rose-300/90">{error()}</p>
                )}
              </Show>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </SidebarFooter>
      </Sidebar>
      <Dialog.Root
        open={reviewSheetOpen()}
        onOpenChange={(open) => {
          if (open) {
            setReviewSheetOpen(true);
            return;
          }
          closeCreateReviewSheet();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] data-[expanded=]:animate-in data-[closed=]:animate-out data-[closed=]:fade-out-0 data-[expanded=]:fade-in-0" />
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <Dialog.Content class="w-full max-w-[40rem] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#16171b] text-neutral-100 shadow-[0_28px_80px_rgba(0,0,0,0.56)] outline-none ring-0">
              <div class="flex h-full flex-col">
                <div class="border-b border-white/[0.06] px-6 py-5 text-left">
                  <Dialog.Title class="text-xl font-semibold text-neutral-100">New review</Dialog.Title>
                  <Dialog.Description class="mt-1 text-[13px] leading-relaxed text-neutral-400">
                    Choose branch and compare target for{" "}
                    <span class="font-semibold text-neutral-200">{reviewSheetRepoLabel()}</span>.
                  </Dialog.Description>
                </div>
                <form
                  class="px-6 py-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateReviewFromSheet();
                  }}
                >
                  <div class="space-y-5">
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Reviewing branch
                      </label>
                      <div class="relative">
                        <input
                          type="text"
                          value={reviewBranchInput()}
                          onInput={(event) => {
                            setReviewBranchInput(event.currentTarget.value);
                            setReviewBranchComboboxOpen(true);
                          }}
                          onFocus={() => setReviewBranchComboboxOpen(true)}
                          onBlur={() => window.setTimeout(() => setReviewBranchComboboxOpen(false), 120)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setReviewBranchComboboxOpen(true);
                            } else if (event.key === "Escape") {
                              setReviewBranchComboboxOpen(false);
                            }
                          }}
                          spellcheck={false}
                          autocomplete="off"
                          placeholder="Current checked-out branch"
                          class="h-10 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 pr-10 text-[13px] text-neutral-100 outline-none ring-0 transition-colors placeholder:text-neutral-600 focus:border-amber-300/60"
                        />
                        <button
                          type="button"
                          aria-label="Toggle branch suggestions"
                          class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-300"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setReviewBranchComboboxOpen((open) => !open)}
                        >
                          <ChevronDown
                            class={`size-4 transition-transform ${reviewBranchComboboxOpen() ? "rotate-180" : ""}`}
                          />
                        </button>
                        <Show when={reviewBranchComboboxOpen()}>
                          <div class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[#111217] shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                            <Show when={reviewCurrentBranch()}>
                              {(branchName) => (
                                <button
                                  type="button"
                                  class="flex w-full items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2 text-left text-[12px] text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setReviewBranchInput(branchName());
                                    setReviewBranchComboboxOpen(false);
                                  }}
                                >
                                  <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-300/80">
                                    Current
                                  </span>
                                  <span class="truncate">{branchName()}</span>
                                </button>
                              )}
                            </Show>
                            <Show when={reviewBranchTypedTarget()}>
                              {(typedTarget) => (
                                <button
                                  type="button"
                                  class="flex w-full items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2 text-left text-[12px] text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-neutral-200"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setReviewBranchInput(typedTarget());
                                    setReviewBranchComboboxOpen(false);
                                  }}
                                >
                                  <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
                                    Use typed branch
                                  </span>
                                  <span class="truncate">{typedTarget()}</span>
                                </button>
                              )}
                            </Show>
                            <div class="max-h-48 overflow-y-auto py-1">
                              <Show when={reviewBaseRefLoading()}>
                                <p class="px-3 py-2 text-[11px] text-neutral-500">Loading branches...</p>
                              </Show>
                              <For each={filteredReviewBranchSuggestions().slice(0, 30)}>
                                {(target) => (
                                  <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setReviewBranchInput(target);
                                      setReviewBranchComboboxOpen(false);
                                    }}
                                  >
                                    <span class="truncate">{target}</span>
                                    <Show
                                      when={
                                        reviewBranchInput().trim().toLowerCase() ===
                                        target.trim().toLowerCase()
                                      }
                                    >
                                      <Check class="size-3.5 text-amber-300/90" />
                                    </Show>
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </div>
                      <p class="text-[11px] text-neutral-500">
                        If different, this branch will be checked out before the review starts.
                      </p>
                    </div>
                    <div class="space-y-1.5">
                      <label class="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Against what exactly?
                      </label>
                      <div class="relative">
                        <input
                          type="text"
                          value={reviewBaseRefInput()}
                          onInput={(event) => {
                            setReviewBaseRefInput(event.currentTarget.value);
                            setReviewBaseRefComboboxOpen(true);
                          }}
                          onFocus={() => setReviewBaseRefComboboxOpen(true)}
                          onBlur={() => window.setTimeout(() => setReviewBaseRefComboboxOpen(false), 120)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setReviewBaseRefComboboxOpen(true);
                            } else if (event.key === "Escape") {
                              setReviewBaseRefComboboxOpen(false);
                            }
                          }}
                          spellcheck={false}
                          autocomplete="off"
                          placeholder="origin/main, v1.2.0, or a1b2c3d"
                          class="h-10 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 pr-10 text-[13px] text-neutral-100 outline-none ring-0 transition-colors placeholder:text-neutral-600 focus:border-amber-300/60"
                        />
                        <button
                          type="button"
                          aria-label="Toggle target suggestions"
                          class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-300"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setReviewBaseRefComboboxOpen((open) => !open)}
                        >
                          <ChevronDown
                            class={`size-4 transition-transform ${reviewBaseRefComboboxOpen() ? "rotate-180" : ""}`}
                          />
                        </button>
                        <Show when={reviewBaseRefComboboxOpen()}>
                          <div class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[#111217] shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                            <Show when={reviewBaseRefSuggested()}>
                              {(target) => (
                                <button
                                  type="button"
                                  class="flex w-full items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2 text-left text-[12px] text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setReviewBaseRefInput(target());
                                    setReviewBaseRefComboboxOpen(false);
                                  }}
                                >
                                  <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-300/80">
                                    Suggested
                                  </span>
                                  <span class="truncate">{target()}</span>
                                </button>
                              )}
                            </Show>
                            <Show when={reviewBaseRefTypedTarget()}>
                              {(typedTarget) => (
                                <button
                                  type="button"
                                  class="flex w-full items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2 text-left text-[12px] text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-neutral-200"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setReviewBaseRefInput(typedTarget());
                                    setReviewBaseRefComboboxOpen(false);
                                  }}
                                >
                                  <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
                                    Use typed ref
                                  </span>
                                  <span class="truncate">{typedTarget()}</span>
                                </button>
                              )}
                            </Show>
                            <div class="max-h-56 overflow-y-auto py-1">
                              <Show when={reviewBaseRefLoading()}>
                                <p class="px-3 py-2 text-[11px] text-neutral-500">Loading targets...</p>
                              </Show>
                              <For each={filteredReviewBaseRefSuggestions().slice(0, 36)}>
                                {(target) => (
                                  <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setReviewBaseRefInput(target);
                                      setReviewBaseRefComboboxOpen(false);
                                    }}
                                  >
                                    <span class="truncate">{target}</span>
                                    <Show
                                      when={
                                        reviewBaseRefInput().trim().toLowerCase() === target.trim().toLowerCase()
                                      }
                                    >
                                      <Check class="size-3.5 text-amber-300/90" />
                                    </Show>
                                  </button>
                                )}
                              </For>
                              <Show
                                when={
                                  !reviewBaseRefLoading() &&
                                  reviewBaseRefTypedTarget() == null &&
                                  filteredReviewBaseRefSuggestions().length === 0
                                }
                              >
                                <p class="px-3 py-2 text-[11px] text-neutral-500">
                                  No matching refs. Keep typing any branch, tag, or SHA.
                                </p>
                              </Show>
                            </div>
                            <Show when={reviewBaseRefLoadError()}>
                              {(error) => (
                                <p class="border-t border-white/[0.06] px-3 py-2 text-[11px] text-amber-300/90">
                                  Could not refresh targets: {error()}
                                </p>
                              )}
                            </Show>
                          </div>
                        </Show>
                      </div>
                      <p class="text-[11px] text-neutral-500">
                        Compare selected branch against this target ref.
                      </p>
                    </div>
                    <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-neutral-400">
                      <p>
                        Reviewing branch:{" "}
                        <span class="font-mono text-neutral-200">
                          {reviewBranchInput().trim() || reviewCurrentBranch() || "current HEAD"}
                        </span>
                      </p>
                      <p class="mt-1">
                        Compare target:{" "}
                        <span class="font-mono text-neutral-200">
                          {reviewBaseRefInput().trim() || "origin/main"}
                        </span>
                      </p>
                      <p class="mt-1 text-[10px] text-neutral-500">
                        Diff scope: {reviewBaseRefInput().trim() || "origin/main"}...HEAD
                      </p>
                    </div>
                  </div>
                  <Show when={reviewDraftError()}>
                    {(message) => <p class="mt-3 text-[12px] text-rose-300/90">{message()}</p>}
                  </Show>
                  <div class="mt-5 flex w-full flex-col gap-2 border-t border-white/[0.06] pt-5 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      class="w-full sm:w-auto"
                      onClick={closeCreateReviewSheet}
                    >
                      Cancel
                    </Button>
                    <Show when={activeReviewDefaults()}>
                      <Button
                        type="button"
                        variant="outline"
                        class="w-full sm:w-auto"
                        disabled={props.providerBusy()}
                        onClick={() => void handleQuickReviewFromSheet()}
                      >
                        Quick review
                      </Button>
                    </Show>
                    <Button
                      type="submit"
                      class="w-full sm:w-auto"
                      disabled={props.providerBusy()}
                    >
                      {props.providerBusy() ? "Creating..." : "Start review"}
                    </Button>
                  </div>
                </form>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
