import { For, Show, createMemo, createSignal, type Accessor } from "solid-js";
import {
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
import * as Popover from "@kobalte/core/popover";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/sheet";
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
import type { AppServerAccountStatus } from "@/lib/backend";

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

  const [reviewSheetOpen, setReviewSheetOpen] = createSignal(false);
  const [reviewDraftRepo, setReviewDraftRepo] = createSignal<RepoGroup | null>(null);
  const [reviewGoalInput, setReviewGoalInput] = createSignal("");
  const [reviewBaseRefInput, setReviewBaseRefInput] = createSignal("");
  const [reviewDraftError, setReviewDraftError] = createSignal<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
  const [rateLimitsExpanded, setRateLimitsExpanded] = createSignal(true);

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

  const openCreateReviewSheet = (repo: RepoGroup) => {
    const defaults = props.reviewDefaultsByRepo()[repo.repoName];
    setReviewDraftRepo(repo);
    setReviewGoalInput(
      defaults?.goal?.trim() || `Review recent changes in ${props.repoDisplayName(repo.repoName)}.`
    );
    setReviewBaseRefInput(defaults?.baseRef?.trim() || props.selectedBaseRef().trim() || "main");
    setReviewDraftError(null);
    setReviewSheetOpen(true);
  };

  const closeCreateReviewSheet = () => {
    setReviewSheetOpen(false);
    setReviewDraftError(null);
  };

  const handleCreateReviewFromSheet = async () => {
    const repo = reviewDraftRepo();
    if (!repo) return;

    const goal = reviewGoalInput().trim();
    if (!goal) {
      setReviewDraftError("What are we reviewing is required.");
      return;
    }

    const baseRef = reviewBaseRefInput().trim();
    if (!baseRef) {
      setReviewDraftError("Against what is required.");
      return;
    }

    setReviewDraftError(null);
    const success = await props.onCreateReviewForRepo(repo, { goal, baseRef });
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
            <Popover.Content class="z-50 w-[340px] rounded-[22px] border border-white/[0.08] bg-[linear-gradient(156deg,rgba(24,25,30,0.98)_0%,rgba(16,17,21,0.98)_100%)] p-4 shadow-[0_28px_80px_rgba(0,0,0,0.56)] backdrop-blur-xl outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0">
              <div class="flex items-center gap-2.5 px-2 py-1">
                <CircleUser class="size-4 text-neutral-500" />
                <p class="truncate text-[15px] font-medium text-neutral-300">{accountEmailLabel()}</p>
              </div>
              <div class="mt-0.5 flex items-center gap-2.5 px-2 py-1">
                <BadgeCheck class="size-4 text-neutral-500" />
                <p class="text-[15px] text-neutral-400">{accountTypeLabel()}</p>
              </div>

              <div class="my-3 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-neutral-100 transition-colors hover:bg-white/[0.06]"
                onClick={handleOpenSettingsFromMenu}
              >
                <Settings class="size-4 text-neutral-400" />
                <span class="text-[15px] font-medium">Settings</span>
              </button>

              <div class="my-3 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-10 w-full items-center justify-between rounded-lg px-2.5 text-left text-neutral-100 transition-colors hover:bg-white/[0.05]"
                onClick={() => setRateLimitsExpanded((open) => !open)}
              >
                <div class="flex items-center gap-2.5">
                  <Gauge class="size-4 text-neutral-300" />
                  <span class="text-[15px] font-medium">Rate limits remaining</span>
                </div>
                <ChevronDown
                  class={`size-4 text-neutral-500 transition-transform ${rateLimitsExpanded() ? "rotate-180" : ""}`}
                />
              </button>

              <Show when={rateLimitsExpanded()}>
                <div class="mt-1 space-y-2.5">
                  <Show when={usageWindows().fiveHourWindow}>
                    {(window) => {
                      const used = clampPercent(window().usedPercent);
                      const left = clampPercent(100 - used);
                      return (
                        <div class="flex items-baseline gap-3 pl-8 pr-1">
                          <p class="w-12 text-[13px] font-semibold text-neutral-100">5h</p>
                          <p class="ml-auto text-[13px] font-semibold tabular-nums text-neutral-300">
                            {left}%
                          </p>
                          <p class="w-[78px] text-right text-[13px] tabular-nums text-neutral-400">
                            {formatQuotaResetTime(window().resetsAt)}
                          </p>
                        </div>
                      );
                    }}
                  </Show>
                  <Show when={usageWindows().weeklyWindow}>
                    {(window) => {
                      const used = clampPercent(window().usedPercent);
                      const left = clampPercent(100 - used);
                      return (
                        <div class="flex items-baseline gap-3 pl-8 pr-1">
                          <p class="w-12 text-[13px] font-semibold text-neutral-100">Weekly</p>
                          <p class="ml-auto text-[13px] font-semibold tabular-nums text-neutral-300">
                            {left}%
                          </p>
                          <p class="w-[78px] text-right text-[13px] tabular-nums text-neutral-400">
                            {formatQuotaResetDate(window().resetsAt)}
                          </p>
                        </div>
                      );
                    }}
                  </Show>
                  <button
                    type="button"
                    class="flex h-9 w-full items-center justify-between rounded-lg px-2.5 pl-8 text-left text-neutral-300 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
                    onClick={() => void handleOpenRateLimitsDocs()}
                  >
                    <span class="text-[14px] font-medium">Learn more</span>
                    <ExternalLink class="size-3.5 text-neutral-500" />
                  </button>
                </div>
              </Show>

              <div class="my-3 h-px bg-white/[0.08]" />

              <button
                type="button"
                class="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-neutral-100 transition-colors hover:bg-white/[0.05]"
                onClick={() => void handleSwitchAccountFromMenu()}
              >
                <LogOut class="size-4 text-neutral-400" />
                <span class="text-[15px] font-medium">Log out</span>
              </button>

              <Show when={props.appServerAccountLoadError()}>
                {(error) => (
                  <p class="mt-2 px-2 text-[11.5px] text-rose-300/90">{error()}</p>
                )}
              </Show>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </SidebarFooter>
      </Sidebar>
      <Sheet
        open={reviewSheetOpen()}
        onOpenChange={(open) => {
          setReviewSheetOpen(open);
          if (!open) {
            setReviewDraftError(null);
          }
        }}
      >
        <SheetContent
          position="right"
          class="w-full border-l border-white/[0.08] bg-[#16171b] p-0 text-neutral-100 sm:max-w-[30rem]"
        >
          <div class="flex h-full flex-col">
            <SheetHeader class="border-b border-white/[0.06] px-6 py-5 text-left">
              <SheetTitle class="text-xl font-semibold text-neutral-100">New review</SheetTitle>
              <SheetDescription class="mt-1 text-[13px] leading-relaxed text-neutral-400">
                Define what you are reviewing and what ref to compare against for{" "}
                <span class="font-semibold text-neutral-200">{reviewSheetRepoLabel()}</span>.
              </SheetDescription>
            </SheetHeader>
            <form
              class="flex flex-1 flex-col px-6 py-5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateReviewFromSheet();
              }}
            >
              <div class="space-y-5">
                <div class="space-y-1.5">
                  <label class="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    What are we reviewing?
                  </label>
                  <textarea
                    value={reviewGoalInput()}
                    onInput={(event) => setReviewGoalInput(event.currentTarget.value)}
                    rows={4}
                    placeholder="Example: API pagination edge cases and error handling"
                    class="w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[13px] leading-relaxed text-neutral-100 outline-none ring-0 transition-colors placeholder:text-neutral-600 focus:border-amber-300/60"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Against what exactly?
                  </label>
                  <input
                    type="text"
                    value={reviewBaseRefInput()}
                    onInput={(event) => setReviewBaseRefInput(event.currentTarget.value)}
                    placeholder="main"
                    class="h-10 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 text-[13px] text-neutral-100 outline-none ring-0 transition-colors placeholder:text-neutral-600 focus:border-amber-300/60"
                  />
                </div>
              </div>
              <Show when={reviewDraftError()}>
                {(message) => <p class="mt-3 text-[12px] text-rose-300/90">{message()}</p>}
              </Show>
              <SheetFooter class="mt-auto border-t border-white/[0.06] pt-5">
                <div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
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
              </SheetFooter>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
