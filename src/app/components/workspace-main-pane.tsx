import { Show, createEffect, type Accessor, type Setter } from "solid-js";
import { LoaderCircle } from "lucide-solid";
import { Button } from "@/components/button";
import { DiffViewer, type DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  createFullReviewScope,
  scopeExistsInPatch,
  type ReviewScope,
} from "@/app/review-scope";
import type { DiffThemePreset } from "@/app/types";
import type { CompareWorkspaceDiffResult } from "@/lib/backend";

export type WorkspaceMainPaneModel = {
  branchActionError: Accessor<string | null>;
  compareError: Accessor<string | null>;
  aiReviewError: Accessor<string | null>;
  aiStatus: Accessor<string | null>;
  aiReviewBusy: Accessor<boolean>;
  aiRunElapsedSeconds: Accessor<number>;
  compareSummary: Accessor<string | null>;
  compareBusy: Accessor<boolean>;
  selectedWorkspace: Accessor<string>;
  handleStartAiReviewOnFullDiff: () => void | Promise<void>;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  showDiffViewer: Accessor<boolean>;
  activeReviewScope: Accessor<ReviewScope>;
  setActiveReviewScope: Setter<ReviewScope>;
  selectedDiffTheme: Accessor<DiffThemePreset>;
  diffAnnotations: Accessor<DiffViewerAnnotation[]>;
};

type WorkspaceMainPaneProps = {
  model: WorkspaceMainPaneModel;
};

export function WorkspaceMainPane(props: WorkspaceMainPaneProps) {
  const model = props.model;

  createEffect(() => {
    const result = model.compareResult();
    const scope = model.activeReviewScope();

    if (!result) {
      if (scope.kind !== "full") {
        model.setActiveReviewScope(createFullReviewScope());
      }
      return;
    }

    if (!scopeExistsInPatch(scope, result.diff)) {
      model.setActiveReviewScope(createFullReviewScope());
    }
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <Show when={model.branchActionError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={model.compareError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={model.aiReviewError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={model.aiStatus()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={model.aiReviewBusy()}>
        <div class="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200/90">
          <LoaderCircle class="size-4 animate-spin text-amber-300/90" />
          <span>
            Review is running. {model.aiRunElapsedSeconds()}s elapsed. Description and issues update live.
          </span>
        </div>
      </Show>

      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
        <span class="text-neutral-400">{model.compareSummary() ?? "No review loaded."}</span>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={model.compareBusy() || model.selectedWorkspace().length === 0}
            onClick={() => void model.handleStartAiReviewOnFullDiff()}
          >
            Start review
          </Button>
        </div>
      </div>

      <Show
        when={model.showDiffViewer() && model.compareResult()}
        fallback={
          <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-[14px] text-neutral-400">
            Start review to load changes.
          </div>
        }
      >
        {(result) => (
          <>
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
                theme={model.selectedDiffTheme().theme}
                themeId={model.selectedDiffTheme().id}
                themeType="dark"
                annotations={model.diffAnnotations()}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
