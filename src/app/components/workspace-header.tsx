import { Show, type Accessor } from "solid-js";
import { ChevronRight } from "lucide-solid";
import { SidebarTrigger } from "@/components/sidebar";
import type { CompareWorkspaceDiffResult } from "@/lib/backend";
import type { RepoReview } from "@/app/types";

type WorkspaceHeaderProps = {
  selectedReview: Accessor<RepoReview | undefined>;
  repoDisplayName: (repoName: string) => string;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  selectedBaseRef: Accessor<string>;
  reviewSidebarCollapsed: Accessor<boolean>;
  toggleReviewSidebar: () => void;
};

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  return (
    <header class="shrink-0 border-b border-white/[0.05] px-6 py-3">
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <SidebarTrigger class="h-8 w-8 shrink-0 rounded-lg border border-white/[0.06] text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-300" />
          <div class="min-w-0">
            <h1 class="app-title truncate text-[clamp(1rem,1.4vw,1.25rem)] text-neutral-100">
              {props.selectedReview()?.title ?? "Select a review"}
            </h1>
            <Show when={props.selectedReview()}>
              {(review) => (
                <div class="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-500">
                  <span>{props.repoDisplayName(review().repoName)}</span>
                  <ChevronRight class="size-3 text-neutral-600" />
                  <span class="text-neutral-400">{review().age} ago</span>
                </div>
              )}
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 text-[12px] font-medium text-neutral-400 transition-colors hover:border-white/[0.12] hover:text-neutral-200"
            onClick={props.toggleReviewSidebar}
          >
            {props.reviewSidebarCollapsed() ? "Show panel" : "Hide panel"}
          </button>
          <div class="flex items-center gap-px rounded-lg border border-white/[0.06] bg-white/[0.02] text-[12px]">
            <div class="flex items-center gap-1.5 border-r border-white/[0.06] px-3 py-1.5">
              <span class="text-neutral-500">Base</span>
              <span class="font-medium text-neutral-300">
                {props.compareResult()?.baseRef ?? props.selectedBaseRef()}
              </span>
            </div>
            <div class="flex items-center gap-1.5 border-r border-white/[0.06] px-3 py-1.5">
              <span class="text-neutral-500">Merge</span>
              <span class="font-mono font-medium text-neutral-300">
                {props.compareResult()?.mergeBase ? props.compareResult()?.mergeBase.slice(0, 8) : "—"}
              </span>
            </div>
            <div class="flex items-center gap-1.5 px-3 py-1.5">
              <span class="text-neutral-500">Head</span>
              <span class="font-mono font-medium text-neutral-300">
                {props.compareResult()?.head ? props.compareResult()?.head.slice(0, 8) : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
