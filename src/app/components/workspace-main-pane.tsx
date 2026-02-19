import { For, Show, createEffect, createMemo, type Accessor, type Setter } from "solid-js";
import { ChevronRight, LoaderCircle } from "lucide-solid";
import { Button } from "@/components/button";
import { DiffViewer, type DiffViewerAnnotation } from "@/components/diff-viewer";
import {
  createFullReviewScope,
  getReviewScopeLabel,
  normalizeDiffPath,
  parsePatchFiles,
  scopeExistsInPatch,
  type ReviewScope,
} from "@/app/review-scope";
import type { DiffThemePreset } from "@/app/types";
import type { CompareWorkspaceDiffResult } from "@/lib/backend";

type WorkspaceMainPaneProps = {
  branchActionError: Accessor<string | null>;
  compareError: Accessor<string | null>;
  aiReviewError: Accessor<string | null>;
  aiStatus: Accessor<string | null>;
  aiReviewBusy: Accessor<boolean>;
  aiRunElapsedSeconds: Accessor<number>;
  compareSummary: Accessor<string | null>;
  compareBusy: Accessor<boolean>;
  selectedWorkspace: Accessor<string>;
  handleStartAiReview: (scopeOverride?: ReviewScope) => void | Promise<void>;
  handleStartAiReviewOnFullDiff: () => void | Promise<void>;
  hasReviewStarted: Accessor<boolean>;
  handleOpenDiffViewer: () => void | Promise<void>;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  showDiffViewer: Accessor<boolean>;
  selectedBaseRef: Accessor<string>;
  activeReviewScope: Accessor<ReviewScope>;
  setActiveReviewScope: Setter<ReviewScope>;
  selectedDiffTheme: Accessor<DiffThemePreset>;
  diffAnnotations: Accessor<DiffViewerAnnotation[]>;
};

export function WorkspaceMainPane(props: WorkspaceMainPaneProps) {
  const parsedDiffFiles = createMemo(() => {
    const result = props.compareResult();
    if (!result) return [];
    return parsePatchFiles(result.diff).filter(
      (file) => normalizeDiffPath(file.filePath).length > 0
    );
  });

  const selectedDiffFile = createMemo(() => {
    const scope = props.activeReviewScope();
    if (scope.kind === "full") return null;
    return (
      parsedDiffFiles().find(
        (file) => normalizeDiffPath(file.filePath) === normalizeDiffPath(scope.filePath)
      ) ?? null
    );
  });

  createEffect(() => {
    const result = props.compareResult();
    const scope = props.activeReviewScope();

    if (!result) {
      if (scope.kind !== "full") {
        props.setActiveReviewScope(createFullReviewScope());
      }
      return;
    }

    if (!scopeExistsInPatch(scope, result.diff)) {
      props.setActiveReviewScope(createFullReviewScope());
    }
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <Show when={props.branchActionError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={props.compareError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={props.aiReviewError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={props.aiStatus()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
            {message()}
          </div>
        )}
      </Show>
      <Show when={props.aiReviewBusy()}>
        <div class="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200/90">
          <LoaderCircle class="size-4 animate-spin text-amber-300/90" />
          <span>
            Review is running. {props.aiRunElapsedSeconds()}s elapsed. Description and issues update live.
          </span>
        </div>
      </Show>

      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
        <span class="text-neutral-400">{props.compareSummary() ?? "No review loaded."}</span>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={props.compareBusy() || props.selectedWorkspace().length === 0}
            onClick={() => void props.handleStartAiReview()}
          >
            {props.hasReviewStarted() ? "Run on scope" : "Start on scope"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.compareBusy() || props.selectedWorkspace().length === 0}
            onClick={() => void props.handleStartAiReviewOnFullDiff()}
            class="border-white/[0.08] text-neutral-300 hover:border-white/[0.16]"
          >
            Run full diff
          </Button>
          <button
            type="button"
            class="flex items-center gap-1 font-medium text-amber-400/80 transition-colors hover:text-amber-300 disabled:cursor-not-allowed disabled:text-neutral-500"
            disabled={props.compareBusy() || props.selectedWorkspace().length === 0}
            onClick={() => void props.handleOpenDiffViewer()}
          >
            {props.compareBusy()
              ? "Comparing..."
              : props.compareResult()
                ? props.showDiffViewer()
                  ? "Hide changes"
                  : "Show changes"
                : `Review vs ${props.selectedBaseRef()}`}
            <ChevronRight class="size-3.5" />
          </button>
        </div>
      </div>

      <Show
        when={props.showDiffViewer() && props.compareResult()}
        fallback={
          <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-[14px] text-neutral-400">
            Load changes to start a scoped review.
          </div>
        }
      >
        {(result) => (
          <>
            <div class="review-scope-toolbar">
              <span class="review-scope-label">Scope</span>
              <button
                type="button"
                class={`review-scope-chip ${props.activeReviewScope().kind === "full" ? "is-active" : ""}`}
                onClick={() => props.setActiveReviewScope(createFullReviewScope())}
              >
                Full diff
              </button>
              <For each={parsedDiffFiles()}>
                {(file) => {
                  const filePath = normalizeDiffPath(file.filePath);
                  const scope = props.activeReviewScope();
                  const isActive =
                    scope.kind !== "full" && normalizeDiffPath(scope.filePath) === filePath;
                  return (
                    <button
                      type="button"
                      class={`review-scope-chip ${isActive ? "is-active" : ""}`}
                      onClick={() => props.setActiveReviewScope({ kind: "file", filePath })}
                      title={filePath}
                    >
                      {filePath}
                    </button>
                  );
                }}
              </For>
            </div>

            <Show when={selectedDiffFile() && selectedDiffFile()!.hunks.length > 0}>
              <div class="review-scope-toolbar review-scope-toolbar-hunks">
                <span class="review-scope-label">Hunks</span>
                <For each={selectedDiffFile()!.hunks}>
                  {(hunk) => {
                    const scope = props.activeReviewScope();
                    const isActive =
                      scope.kind === "hunk" && scope.hunkIndex === hunk.hunkIndex;
                    return (
                      <button
                        type="button"
                        class={`review-scope-chip ${isActive ? "is-active" : ""}`}
                        onClick={() =>
                          props.setActiveReviewScope({
                            kind: "hunk",
                            filePath: selectedDiffFile()!.filePath,
                            hunkIndex: hunk.hunkIndex,
                          })
                        }
                        title={hunk.header}
                      >
                        Hunk {hunk.hunkIndex}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            <div class="mb-3 text-[12px] text-neutral-500">
              Active scope: <span class="text-neutral-300">{getReviewScopeLabel(props.activeReviewScope())}</span>
            </div>

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
                theme={props.selectedDiffTheme().theme}
                themeId={props.selectedDiffTheme().id}
                themeType="dark"
                annotations={props.diffAnnotations()}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
