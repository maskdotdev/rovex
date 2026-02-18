import { For, Show, type Accessor, type Setter } from "solid-js";
import {
  Check,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  PlusCircle,
  Search,
  Send,
} from "lucide-solid";
import * as Popover from "@kobalte/core/popover";
import { Button } from "@/components/button";
import { DiffViewer, type DiffViewerAnnotation } from "@/components/diff-viewer";
import { TextField, TextFieldInput } from "@/components/text-field";
import type { DiffThemePreset } from "@/app/types";
import type {
  AiReviewChunk,
  AiReviewFinding,
  AiReviewProgressEvent,
  CompareWorkspaceDiffResult,
  ListWorkspaceBranchesResult,
  WorkspaceBranch,
} from "@/lib/backend";

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
  handleStartAiReview: () => void | Promise<void>;
  hasReviewStarted: Accessor<boolean>;
  handleOpenDiffViewer: () => void | Promise<void>;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  showDiffViewer: Accessor<boolean>;
  selectedBaseRef: Accessor<string>;
  selectedDiffTheme: Accessor<DiffThemePreset>;
  diffAnnotations: Accessor<DiffViewerAnnotation[]>;
  aiChunkReviews: Accessor<AiReviewChunk[]>;
  aiFindings: Accessor<AiReviewFinding[]>;
  aiProgressEvents: Accessor<AiReviewProgressEvent[]>;
  threadMessagesLoadError: Accessor<string | null>;
  aiPrompt: Accessor<string>;
  setAiPrompt: Setter<string>;
  handleAskAiFollowUp: (event: Event) => void | Promise<void>;
  branchPopoverOpen: Accessor<boolean>;
  setBranchPopoverOpen: Setter<boolean>;
  workspaceBranches: Accessor<ListWorkspaceBranchesResult | null | undefined>;
  workspaceBranchesLoading: Accessor<boolean>;
  currentWorkspaceBranch: Accessor<string>;
  branchSearchQuery: Accessor<string>;
  setBranchSearchQuery: Setter<string>;
  filteredWorkspaceBranches: Accessor<WorkspaceBranch[]>;
  branchActionBusy: Accessor<boolean>;
  handleCheckoutBranch: (branchName: string) => void | Promise<void>;
  workspaceBranchLoadError: Accessor<string | null>;
  branchCreateMode: Accessor<boolean>;
  handleCreateAndCheckoutBranch: (event: Event) => void | Promise<void>;
  setBranchSearchInputRef: (element: HTMLInputElement | undefined) => void;
  setBranchCreateInputRef: (element: HTMLInputElement | undefined) => void;
  newBranchName: Accessor<string>;
  setNewBranchName: Setter<string>;
  setBranchCreateMode: Setter<boolean>;
  canCreateBranch: Accessor<boolean>;
  handleStartCreateBranch: () => void;
};

export function WorkspaceMainPane(props: WorkspaceMainPaneProps) {
  const {
    branchActionError,
    compareError,
    aiReviewError,
    aiStatus,
    aiReviewBusy,
    aiRunElapsedSeconds,
    compareSummary,
    compareBusy,
    selectedWorkspace,
    handleStartAiReview,
    hasReviewStarted,
    handleOpenDiffViewer,
    compareResult,
    showDiffViewer,
    selectedBaseRef,
    selectedDiffTheme,
    diffAnnotations,
    aiChunkReviews,
    aiFindings,
    aiProgressEvents,
    threadMessagesLoadError,
    aiPrompt,
    setAiPrompt,
    handleAskAiFollowUp,
    branchPopoverOpen,
    setBranchPopoverOpen,
    workspaceBranches,
    workspaceBranchesLoading,
    currentWorkspaceBranch,
    branchSearchQuery,
    setBranchSearchQuery,
    filteredWorkspaceBranches,
    branchActionBusy,
    handleCheckoutBranch,
    workspaceBranchLoadError,
    branchCreateMode,
    handleCreateAndCheckoutBranch,
    setBranchSearchInputRef,
    setBranchCreateInputRef,
    newBranchName,
    setNewBranchName,
    setBranchCreateMode,
    canCreateBranch,
    handleStartCreateBranch,
  } = props;

  return (
    <>
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
              <Show when={aiReviewBusy()}>
                <div class="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200/90">
                  <LoaderCircle class="size-4 animate-spin text-amber-300/90" />
                  <span>
                    Review is running. {aiRunElapsedSeconds()}s elapsed. Notes refresh automatically.
                  </span>
                </div>
              </Show>

              {/* Change summary bar */}
              <div class="mb-3 flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13px]">
                <span class="text-neutral-400">{compareSummary() ?? "No review loaded."}</span>
                <div class="flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={aiReviewBusy() || compareBusy() || selectedWorkspace().length === 0}
                    onClick={() => void handleStartAiReview()}
                  >
                    {aiReviewBusy()
                      ? "Starting..."
                      : hasReviewStarted()
                        ? "Run review again"
                        : "Start review"}
                  </Button>
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
                      annotations={diffAnnotations()}
                    />
                  </Show>
                )}
              </Show>

              <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div class="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
                  <h3 class="text-[12px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
                    Chunk Reviews
                  </h3>
                  <span class="text-[12px] text-neutral-600">
                    {aiChunkReviews().length} chunks • {aiFindings().length} findings{aiReviewBusy() ? " • live" : ""}
                  </span>
                </div>
                <Show
                  when={aiProgressEvents().length > 0}
                  fallback={null}
                >
                  <div class="max-h-[7rem] space-y-1.5 overflow-y-auto border-b border-white/[0.05] px-4 py-2">
                    <For each={aiProgressEvents().slice(Math.max(0, aiProgressEvents().length - 8))}>
                      {(event) => (
                        <p class="text-[12px] text-neutral-500">
                          {event.message}
                        </p>
                      )}
                    </For>
                  </div>
                </Show>
                <Show
                  when={aiChunkReviews().length > 0}
                  fallback={
                    <p class="px-4 py-4 text-[13px] text-neutral-500">
                      Start review to analyze each diff chunk and generate inline findings.
                    </p>
                  }
                >
                  <div class="max-h-[20rem] space-y-2 overflow-y-auto px-3 py-3">
                    <For each={aiChunkReviews()}>
                      {(chunk) => (
                        <div class="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
                          <div class="mb-1.5 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                            <span class="truncate">{chunk.filePath} • chunk {chunk.chunkIndex}</span>
                            <span class="shrink-0 normal-case text-neutral-600">
                              {chunk.findings.length} finding{chunk.findings.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <p class="text-[13px] leading-5 text-neutral-300">{chunk.summary}</p>
                          <Show when={chunk.findings.length > 0}>
                            <div class="mt-2 space-y-2">
                              <For each={chunk.findings}>
                                {(finding) => (
                                  <div class="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[12.5px] text-amber-100/90">
                                    <p class="font-medium text-amber-200/90">
                                      [{finding.severity}] {finding.title} ({finding.side}:{finding.lineNumber})
                                    </p>
                                    <p class="mt-1 text-amber-100/80">{finding.body}</p>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={threadMessagesLoadError()}>
                  {(message) => (
                    <p class="border-t border-white/[0.05] px-4 py-3 text-[12px] text-rose-300/90">
                      Unable to refresh conversation history: {message()}
                    </p>
                  )}
                </Show>
              </div>
            </div>

            {/* Input area */}
            <footer class="shrink-0 px-6 pb-4 pt-3">
              <form
                class="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                onSubmit={(event) => void handleAskAiFollowUp(event)}
              >
                <TextField>
                  <TextFieldInput
                    value={aiPrompt()}
                    onInput={(event) => setAiPrompt(event.currentTarget.value)}
                    placeholder={
                      hasReviewStarted()
                        ? "Ask a follow-up question about this review..."
                        : "Click Start review above to begin."
                    }
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
                          {workspaceBranchesLoading() && !workspaceBranches()
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
                                setBranchSearchInputRef(element);
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
                              when={!workspaceBranchesLoading()}
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
                                      setBranchCreateInputRef(element);
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
                      disabled={
                        aiReviewBusy() ||
                        compareBusy() ||
                        selectedWorkspace().length === 0 ||
                        !hasReviewStarted() ||
                        aiPrompt().trim().length === 0
                      }
                      class="h-8 w-8 rounded-xl bg-amber-500/90 text-neutral-900 shadow-[0_0_12px_rgba(212,175,55,0.15)] hover:bg-amber-400/90 disabled:bg-neutral-700 disabled:text-neutral-400"
                    >
                      <Send class="size-3.5" />
                    </Button>
                  </div>
                </div>
              </form>
            </footer>
    </>
  );
}
