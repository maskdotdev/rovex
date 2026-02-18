import { For, Show, type Accessor } from "solid-js";
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
import type { RepoGroup } from "@/app/types";

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
  onOpenSettings: () => void;
};

export function WorkspaceRepoSidebar(props: WorkspaceRepoSidebarProps) {
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
                          class="absolute right-2 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-200"
                          aria-label={`Open menu for ${props.repoDisplayName(repo.repoName)}`}
                          title={`Open menu for ${props.repoDisplayName(repo.repoName)}`}
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
                        <SidebarMenuSub class="mt-0.5 border-white/[0.05]">
                          <For each={repo.reviews}>
                            {(review) => (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  as="button"
                                  type="button"
                                  isActive={props.selectedThreadId() === review.id}
                                  class="h-8 w-full justify-between rounded-lg text-[13px] text-neutral-500 transition-all duration-150 data-[active=true]:bg-white/[0.06] data-[active=true]:text-neutral-200 hover:text-neutral-300"
                                  onClick={() => props.onSelectThread(review.id)}
                                >
                                  <span class="truncate">{review.title}</span>
                                  <span class="shrink-0 text-[11px] tabular-nums text-neutral-600">
                                    {review.age}
                                  </span>
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
        <SidebarMenu>
          <SidebarRow label="Settings" onClick={props.onOpenSettings} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
