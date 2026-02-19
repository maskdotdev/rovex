import { For, Show, createMemo, type Accessor } from "solid-js";
import {
  ChevronRight,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-solid";
import * as Popover from "@kobalte/core/popover";
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
import { SidebarRow } from "@/app/components/sidebar-row";
import type { RepoGroup, RepoReview } from "@/app/types";
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
  onCreateReviewForRepo: (repo: RepoGroup) => void | Promise<void>;
  isRepoMenuOpen: (repoName: string) => boolean;
  setRepoMenuOpenState: (repoName: string, open: boolean) => void;
  onRenameRepo: (repo: RepoGroup) => void;
  onRemoveRepo: (repo: RepoGroup) => void | Promise<void>;
  onRemoveReview: (repo: RepoGroup, review: RepoReview) => void | Promise<void>;
  onOpenSettings: () => void;
  appServerAccountStatus: Accessor<AppServerAccountStatus | undefined>;
  appServerAccountLoadError: Accessor<string | null>;
  maskAccountEmail: Accessor<boolean>;
};

export function WorkspaceRepoSidebar(props: WorkspaceRepoSidebarProps) {
  const formatQuotaReset = (unixSeconds: number | null | undefined) => {
    if (!unixSeconds || unixSeconds <= 0) {
      return "Unknown";
    }
    const date = new Date(unixSeconds * 1000);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleString();
  };

  const accountLabel = createMemo(() => {
    const email = props.appServerAccountStatus()?.email?.trim();
    if (!email) {
      return "Unknown";
    }
    if (props.maskAccountEmail()) {
      return "Hidden";
    }
    const localPart = email.split("@")[0] ?? email;
    const firstFour = localPart.slice(0, 4);
    return firstFour || "Unknown";
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

  return (
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
                          void props.onCreateReviewForRepo(repo);
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
        <Popover.Root placement="right-start" gutter={10}>
          <Popover.Trigger
            as="button"
            type="button"
            class="mb-2 flex h-11 w-full items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 text-left outline-none ring-sidebar-ring transition-colors hover:border-white/[0.14] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div class="min-w-0">
              <p class="truncate text-[13px] font-medium text-neutral-100">Codex</p>
              <p class="truncate text-[11.5px] text-neutral-500">Account: {accountLabel()}</p>
            </div>
            <span
              class={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${
                props.appServerAccountStatus()?.available
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-300/90"
              }`}
            >
              {props.appServerAccountStatus()?.available ? "Live" : "Offline"}
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-50 w-[320px] rounded-xl border border-white/[0.08] bg-[#16171b] p-3.5 shadow-[0_20px_56px_rgba(0,0,0,0.5)] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                Codex usage
              </p>
              <p class="mt-2 text-[12.5px] text-neutral-300">
                Account: <span class="font-mono text-neutral-100">{accountLabel()}</span>
              </p>
              <p class="mt-1.5 text-[12.5px] text-neutral-300">
                Plan: <span class="font-mono text-neutral-100">{props.appServerAccountStatus()?.planType ?? "Unknown"}</span>
              </p>
              <Show when={usageWindows().fiveHourWindow}>
                {(window) => {
                  const used = clampPercent(window().usedPercent);
                  const left = clampPercent(100 - used);
                  return (
                    <div class="mt-2.5">
                      <div class="flex items-center justify-between gap-2">
                        <p class="text-[12px] text-neutral-400">Primary (5hr)</p>
                        <p class="text-[11.5px] font-mono text-neutral-200">{left}% left</p>
                      </div>
                      <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          class="h-full rounded-full bg-amber-400/80 transition-[width] duration-300"
                          style={{ width: `${used}%` }}
                        />
                      </div>
                      <p class="mt-1 text-[11.5px] text-neutral-500">
                        {used}% used, resets {formatQuotaReset(window().resetsAt)}
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
                    <div class="mt-2.5">
                      <div class="flex items-center justify-between gap-2">
                        <p class="text-[12px] text-neutral-400">Secondary (weekly)</p>
                        <p class="text-[11.5px] font-mono text-neutral-200">{left}% left</p>
                      </div>
                      <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          class="h-full rounded-full bg-emerald-400/80 transition-[width] duration-300"
                          style={{ width: `${used}%` }}
                        />
                      </div>
                      <p class="mt-1 text-[11.5px] text-neutral-500">
                        {used}% used, resets {formatQuotaReset(window().resetsAt)}
                      </p>
                    </div>
                  );
                }}
              </Show>
              <Show when={props.appServerAccountStatus()?.rateLimits?.credits}>
                {(credits) => (
                  <p class="mt-1.5 text-[12px] text-neutral-400">
                    Credits:{" "}
                    <span class="font-mono text-neutral-200">
                      {credits().balance ?? "n/a"} (has: {credits().hasCredits ? "yes" : "no"})
                    </span>
                  </p>
                )}
              </Show>
              <Show when={props.appServerAccountStatus()?.detail}>
                {(detail) => (
                  <p class="mt-2.5 text-[11.5px] text-neutral-500">{detail()}</p>
                )}
              </Show>
              <Show when={props.appServerAccountLoadError()}>
                {(error) => (
                  <p class="mt-2.5 text-[11.5px] text-rose-300/90">{error()}</p>
                )}
              </Show>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <SidebarMenu>
          <SidebarRow label="Settings" onClick={props.onOpenSettings} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
