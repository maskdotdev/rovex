import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
  type Setter,
} from "solid-js";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  PlusCircle,
  Search,
  Send,
} from "lucide-solid";
import * as Popover from "@kobalte/core/popover";
import { Button } from "@/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
} from "@/components/sidebar";
import { TextField, TextFieldInput } from "@/components/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip";
import { normalizeDiffPath, parsePatchFiles, type ReviewScope } from "@/app/review-scope";
import { formatReviewMessage } from "@/app/review-text";
import type {
  ReviewDiffFocusTarget,
  ReviewChatSharedDiffContext,
  ReviewRun,
  ReviewWorkbenchTab,
} from "@/app/review-types";
import {
  useWorkspaceReviewSidebarViewModel,
  type IssueFileCard,
} from "@/app/components/workspace-review-sidebar-view-model";
import type {
  AiReviewChunk,
  AiReviewFinding,
  AiReviewProgressEvent,
  CompareWorkspaceDiffResult,
  ListWorkspaceBranchesResult,
  Message as ThreadMessage,
  WorkspaceBranch,
} from "@/lib/backend";

export type WorkspaceReviewSidebarModel = {
  reviewSidebarCollapsed?: Accessor<boolean>;
  activeReviewScope: Accessor<ReviewScope>;
  setActiveReviewScope: Setter<ReviewScope>;
  aiChunkReviews: Accessor<AiReviewChunk[]>;
  aiFindings: Accessor<AiReviewFinding[]>;
  aiProgressEvents: Accessor<AiReviewProgressEvent[]>;
  reviewRuns: Accessor<ReviewRun[]>;
  selectedRunId: Accessor<string | null>;
  setSelectedRunId: Setter<string | null>;
  reviewWorkbenchTab: Accessor<ReviewWorkbenchTab>;
  setReviewWorkbenchTab: Setter<ReviewWorkbenchTab>;
  threadMessagesLoadError: Accessor<string | null>;
  threadMessages: Accessor<ThreadMessage[] | undefined>;
  aiPrompt: Accessor<string>;
  setAiPrompt: Setter<string>;
  aiSharedDiffContexts: Accessor<ReviewChatSharedDiffContext[]>;
  setAiSharedDiffContexts: Setter<ReviewChatSharedDiffContext[]>;
  handleAskAiFollowUp: (event: Event) => void | Promise<void>;
  handleCancelAiReviewRun: (runId: string) => void | Promise<void>;
  aiReviewBusy: Accessor<boolean>;
  aiFollowUpBusy?: Accessor<boolean>;
  compareBusy: Accessor<boolean>;
  setShowDiffViewer: Setter<boolean>;
  setDiffFocusTarget: Setter<ReviewDiffFocusTarget | null>;
  selectedWorkspace: Accessor<string>;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  hasReviewStarted?: Accessor<boolean>;
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

type WorkspaceReviewSidebarProps = {
  model: WorkspaceReviewSidebarModel;
};

function formatRunTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const reviewWorkbenchTabs = [
  { id: "description", label: "Description" },
  { id: "issues", label: "Issues" },
  { id: "chat", label: "Chat" },
] as const satisfies ReadonlyArray<{ id: ReviewWorkbenchTab; label: string }>;

const tabShowsRunActivity = (tabId: ReviewWorkbenchTab) =>
  tabId === "description" || tabId === "issues";

const REVIEW_ISSUE_CARD_EXPANDED_STORAGE_KEY =
  "rovex.workspace.review-issue-card-expanded";

function readStoredExpandedIssueCards(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REVIEW_ISSUE_CARD_EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function getPathLeaf(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

const MAX_CHAT_MENTION_SUGGESTIONS = 10;

type ActiveChatMention = {
  start: number;
  end: number;
  query: string;
};

function collectDiffFilePathsFromPatch(patch: string): string[] {
  const seen = new Set<string>();
  const orderedPaths: string[] = [];
  for (const file of parsePatchFiles(patch)) {
    const normalizedPath = normalizeDiffPath(file.filePath);
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    orderedPaths.push(normalizedPath);
  }
  return orderedPaths;
}

function resolveActiveChatMention(prompt: string, cursorPosition: number): ActiveChatMention | null {
  const safeCursor = Math.max(0, Math.min(cursorPosition, prompt.length));
  let tokenStart = safeCursor;
  while (tokenStart > 0 && !/\s/.test(prompt[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }
  let tokenEnd = safeCursor;
  while (tokenEnd < prompt.length && !/\s/.test(prompt[tokenEnd] ?? "")) {
    tokenEnd += 1;
  }

  const token = prompt.slice(tokenStart, tokenEnd);
  if (!token.startsWith("@")) return null;
  if (token.slice(1).includes("@")) return null;

  return {
    start: tokenStart,
    end: tokenEnd,
    query: token.slice(1),
  };
}

export function WorkspaceReviewSidebar(props: WorkspaceReviewSidebarProps) {
  const model = props.model;
  const isCollapsed = createMemo(() => model.reviewSidebarCollapsed?.() ?? false);
  const isFollowUpBusy = createMemo(() => model.aiFollowUpBusy?.() ?? model.aiReviewBusy());
  const [expandedIssueCards, setExpandedIssueCards] = createSignal<Record<string, boolean>>(
    readStoredExpandedIssueCards()
  );
  const derived = useWorkspaceReviewSidebarViewModel({
    reviewRuns: model.reviewRuns,
    selectedRunId: model.selectedRunId,
    setSelectedRunId: model.setSelectedRunId,
    aiChunkReviews: model.aiChunkReviews,
    aiFindings: model.aiFindings,
    aiProgressEvents: model.aiProgressEvents,
    aiReviewBusy: model.aiReviewBusy,
  });
  const selectedRun = derived.selectedRun;
  const visibleFindings = derived.visibleFindings;
  const visibleProgressEvents = derived.visibleProgressEvents;
  const issueFileCards = derived.issueFileCards;
  const flaggedIssueFileCards = derived.flaggedIssueFileCards;
  const cleanIssueFileCards = derived.cleanIssueFileCards;
  const latestProgress = derived.latestProgress;
  const progressRatio = derived.progressRatio;
  const issuesEmptyMessage = derived.issuesEmptyMessage;
  const activeCancelableRun = createMemo<ReviewRun | null>(() => {
    const selected = selectedRun();
    if (selected && (selected.status === "queued" || selected.status === "running")) {
      return selected;
    }
    return (
      model
        .reviewRuns()
        .find((run) => run.status === "queued" || run.status === "running") ?? null
    );
  });
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REVIEW_ISSUE_CARD_EXPANDED_STORAGE_KEY,
      JSON.stringify(expandedIssueCards())
    );
  });

  let tabRefs: Array<HTMLButtonElement | undefined> = [];
  let chatPromptInputRef: HTMLInputElement | undefined;
  const branchPopoverContentId = "workspace-branch-picker-popover";
  const branchSearchInputId = "workspace-branch-search-input";
  const branchCreateInputId = "workspace-branch-create-input";
  const [chatPromptCursorPosition, setChatPromptCursorPosition] = createSignal(0);
  const diffFilePaths = createMemo(() => {
    const patch = model.compareResult()?.diff ?? "";
    if (!patch.trim()) return [];
    return collectDiffFilePathsFromPatch(patch);
  });
  const activeChatMention = createMemo(() =>
    resolveActiveChatMention(model.aiPrompt(), chatPromptCursorPosition())
  );
  const mentionSuggestions = createMemo(() => {
    const mention = activeChatMention();
    if (!mention) return [];
    const normalizedQuery = mention.query.trim().toLowerCase();
    if (!normalizedQuery) {
      return diffFilePaths().slice(0, MAX_CHAT_MENTION_SUGGESTIONS);
    }

    const ranked = diffFilePaths().filter((path) => {
      const normalizedPath = path.toLowerCase();
      const leaf = getPathLeaf(path).toLowerCase();
      return normalizedPath.includes(normalizedQuery) || leaf.includes(normalizedQuery);
    });
    return ranked.slice(0, MAX_CHAT_MENTION_SUGGESTIONS);
  });
  const syncChatPromptCursorPosition = () => {
    if (!chatPromptInputRef) return;
    setChatPromptCursorPosition(chatPromptInputRef.selectionStart ?? chatPromptInputRef.value.length);
  };
  const applyMentionSuggestion = (filePath: string) => {
    const mention = activeChatMention();
    if (!mention) return;
    const prompt = model.aiPrompt();
    const before = prompt.slice(0, mention.start);
    const after = prompt.slice(mention.end);
    const replacement = `@${filePath}`;
    const withTrailingSpace =
      after.length === 0 || /^\s/.test(after) ? replacement : `${replacement} `;
    const nextPrompt = `${before}${withTrailingSpace}${after}`;
    const nextCursorPosition = before.length + withTrailingSpace.length;
    model.setAiPrompt(nextPrompt);
    queueMicrotask(() => {
      if (!chatPromptInputRef) return;
      chatPromptInputRef.focus();
      chatPromptInputRef.setSelectionRange(nextCursorPosition, nextCursorPosition);
      setChatPromptCursorPosition(nextCursorPosition);
    });
  };
  const issueCardExpandKey = (card: IssueFileCard) => normalizeDiffPath(card.filePath) || card.id;
  const isIssueCardExpanded = (card: IssueFileCard) => {
    const key = issueCardExpandKey(card);
    return expandedIssueCards()[key] ?? true;
  };
  const toggleIssueCardExpanded = (card: IssueFileCard) => {
    const key = issueCardExpandKey(card);
    setExpandedIssueCards((current) => ({
      ...current,
      [key]: !(current[key] ?? true),
    }));
  };
  const renderIssueFileCard = (card: IssueFileCard) => (
    <article
      class={`rounded-lg border px-3 py-2 ${
        card.status === "issues"
          ? "border-amber-500/25 bg-amber-500/8"
          : card.status === "failed"
            ? "border-rose-500/25 bg-rose-500/8"
            : "border-white/[0.07] bg-white/[0.02]"
      }`}
    >
      <div class="flex items-center justify-between gap-2">
        <Tooltip openDelay={120} closeDelay={90}>
          <TooltipTrigger class="block min-w-0 flex-1 text-left">
            <p class="truncate text-left text-[12px] font-medium text-neutral-200">
              {getPathLeaf(card.filePath)}
            </p>
          </TooltipTrigger>
          <TooltipContent class="max-w-[28rem] break-all text-[11px]">{card.filePath}</TooltipContent>
        </Tooltip>
        <div class="flex items-center gap-2">
          <Show when={card.status === "issues" || card.status === "failed"}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-white/[0.08] bg-black/20 p-1 text-neutral-400 transition-colors hover:text-neutral-200"
              aria-label={isIssueCardExpanded(card) ? "Collapse issue details" : "Expand issue details"}
              aria-expanded={isIssueCardExpanded(card)}
              onClick={() => toggleIssueCardExpanded(card)}
            >
              <ChevronRight
                class={`size-3.5 transition-transform ${isIssueCardExpanded(card) ? "rotate-90" : ""}`}
              />
            </button>
          </Show>
          <Show
            when={card.status === "running"}
            fallback={
              <Show
                when={card.status === "clean"}
                fallback={
                  <Show
                    when={card.status === "failed"}
                    fallback={
                      <span class="text-[11px] text-amber-200/90">
                        {card.findings.length} issue{card.findings.length === 1 ? "" : "s"}
                      </span>
                    }
                  >
                    <AlertTriangle class="size-4 text-rose-300/90" />
                  </Show>
                }
              >
                <CheckCircle2 class="size-4 text-emerald-300/90" />
              </Show>
            }
          >
            <LoaderCircle class="size-4 animate-spin text-amber-300/90" />
          </Show>
        </div>
      </div>

      <Show when={(card.status === "issues" || card.status === "failed") && isIssueCardExpanded(card)}>
        <div class="mt-2 space-y-2">
          <Show when={card.status === "failed"}>
            <p class="review-stream-message text-[12px] text-rose-300/90">
              {formatReviewMessage(card.errorMessage ?? "Issue scan failed for this file.", 700)}
            </p>
          </Show>
          <Show when={card.status === "issues" && card.summary.trim().length > 0}>
            <p class="review-stream-message text-[12px] text-neutral-300">
              {formatReviewMessage(card.summary, 900)}
            </p>
          </Show>
          <For each={card.findings}>
            {(finding) => (
              <div class="rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-2">
                <div class="mb-1 flex items-center justify-between gap-2">
                  <p class="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-200/90">
                    {finding.severity}
                  </p>
                  <span class="text-[11px] text-neutral-400">{finding.lineNumber}</span>
                </div>
                <p class="text-[12.5px] font-medium text-neutral-200">{finding.title}</p>
                <p class="review-stream-message mt-1 text-[12px] text-neutral-300">
                  {formatReviewMessage(finding.body, 1_100)}
                </p>
                <div class="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    class="review-inline-action"
                    onClick={() => {
                      const filePath = normalizeDiffPath(finding.filePath);
                      const lineNumber = Number.isFinite(finding.lineNumber)
                        ? Math.max(1, Math.floor(finding.lineNumber))
                        : null;
                      model.setShowDiffViewer(true);
                      model.setActiveReviewScope({
                        kind: "file",
                        filePath,
                      });
                      model.setDiffFocusTarget({
                        filePath,
                        lineNumber,
                        findingId: finding.id || null,
                        side: finding.side || null,
                      });
                    }}
                  >
                    Jump to file
                  </button>
                  <button
                    type="button"
                    class="review-inline-action"
                    onClick={() => {
                      model.setReviewWorkbenchTab("chat");
                      model.setAiPrompt(
                        `Explain this issue and propose a fix: [${finding.severity}] ${finding.title} at ${finding.filePath}:${finding.lineNumber}`
                      );
                    }}
                  >
                    Ask AI
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </article>
  );

  return (
    <Sidebar
      id="review-workbench-sidebar"
      side="right"
      collapsible="none"
      class={`h-svh max-h-svh shrink-0 overflow-hidden border-0 bg-transparent px-2.5 py-2 transition-[width,opacity,padding] duration-200 ease-linear [&_[data-sidebar=sidebar]]:rounded-2xl [&_[data-sidebar=sidebar]]:border [&_[data-sidebar=sidebar]]:border-white/[0.06] [&_[data-sidebar=sidebar]]:bg-white/[0.02] ${
        isCollapsed()
          ? "w-0 min-w-0 px-0 py-0 opacity-0 pointer-events-none"
          : "w-[26rem] min-w-[26rem] opacity-100"
      }`}
    >
      <SidebarContent class="p-2">
        <SidebarGroup class="h-full min-h-0 p-0">
          <div class="mb-2 flex items-center gap-2">
            <div class="review-right-tabs flex-1" role="tablist" aria-label="Review workbench tabs">
              <For each={reviewWorkbenchTabs}>
                {(tab, index) => (
                  <button
                    ref={(element) => {
                      tabRefs[index()] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`review-workbench-tab-${tab.id}`}
                    aria-controls={`review-workbench-panel-${tab.id}`}
                    aria-selected={model.reviewWorkbenchTab() === tab.id}
                    tabIndex={model.reviewWorkbenchTab() === tab.id ? 0 : -1}
                    class={`review-tab-trigger ${model.reviewWorkbenchTab() === tab.id ? "is-active" : ""}`}
                    onClick={() => model.setReviewWorkbenchTab(tab.id)}
                    onKeyDown={(event) => {
                      const currentIndex = index();
                      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        const delta = event.key === "ArrowRight" ? 1 : -1;
                        const nextIndex =
                          (currentIndex + delta + reviewWorkbenchTabs.length) %
                          reviewWorkbenchTabs.length;
                        const nextTab = reviewWorkbenchTabs[nextIndex];
                        model.setReviewWorkbenchTab(nextTab.id);
                        tabRefs[nextIndex]?.focus();
                        return;
                      }
                      if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        const nextIndex = event.key === "Home" ? 0 : reviewWorkbenchTabs.length - 1;
                        const nextTab = reviewWorkbenchTabs[nextIndex];
                        model.setReviewWorkbenchTab(nextTab.id);
                        tabRefs[nextIndex]?.focus();
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        model.setReviewWorkbenchTab(tab.id);
                      }
                    }}
                  >
                    <span class="inline-flex items-center gap-1.5">
                      {tab.label}
                      <Show when={tabShowsRunActivity(tab.id) && model.aiReviewBusy()}>
                        <LoaderCircle class="size-3 animate-spin text-amber-300/90" aria-hidden="true" />
                      </Show>
                    </span>
                  </button>
                )}
              </For>
            </div>
            <Show when={activeCancelableRun()}>
              {(run) => (
                <button
                  type="button"
                  class="review-inline-action shrink-0"
                  onClick={() => void model.handleCancelAiReviewRun(run().id)}
                >
                  Stop
                </button>
              )}
            </Show>
          </div>

          <div class={`review-right-content ${model.reviewWorkbenchTab() === "chat" ? "is-chat" : ""}`}>
            <Show when={model.reviewWorkbenchTab() === "description"}>
              <section
                id="review-workbench-panel-description"
                role="tabpanel"
                aria-labelledby="review-workbench-tab-description"
                tabIndex={0}
              >
              <Show
                when={selectedRun()}
                fallback={<p class="review-empty-state">Run AI review to build a chunked description of the active scope.</p>}
              >
                {(run) => (
                  <>
                    <div class="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div class="mb-1 flex items-center justify-between gap-2">
                        <p class="truncate text-[12.5px] font-medium text-neutral-200">{run().scopeLabel}</p>
                        <div class="flex items-center gap-1.5">
                          <span
                            class={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                              run().status === "completed"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : run().status === "completed_with_errors"
                                  ? "bg-amber-500/15 text-amber-300"
                                  : run().status === "failed" || run().status === "canceled"
                                    ? "bg-rose-500/15 text-rose-300"
                                    : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {run().status}
                          </span>
                          <Show when={run().status === "queued" || run().status === "running"}>
                            <button
                              type="button"
                              class="review-inline-action"
                              onClick={() => void model.handleCancelAiReviewRun(run().id)}
                            >
                              Cancel
                            </button>
                          </Show>
                        </div>
                      </div>
                      <p class="text-[11px] text-neutral-500">
                        {formatRunTime(run().startedAt)} • {run().findings.length} findings
                        {run().model ? ` • ${run().model}` : ""}
                      </p>
                      <Show when={latestProgress()}>
                        {(progress) => (
                          <div class="mt-2">
                            <p class="review-stream-message text-[11px] text-neutral-400">
                              {formatReviewMessage(progress().message, 420)}
                            </p>
                            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                              <div
                                class="h-full rounded-full bg-amber-400/80 transition-all duration-150"
                                style={{ width: `${progressRatio()}%` }}
                              />
                            </div>
                            <p class="mt-1 text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                              {progress().completedChunks}/{progress().totalChunks} chunks analyzed
                            </p>
                          </div>
                        )}
                      </Show>
                    </div>

                    <Show when={run().status === "failed"}>
                      <div class="rounded-lg border border-rose-500/18 bg-rose-500/8 px-3 py-2 text-[12px] text-rose-300/90">
                        <p class="review-stream-message review-stream-message-compact">
                          {formatReviewMessage(run().error ?? "Review run failed.", 1_600)}
                        </p>
                      </div>
                    </Show>

                    <Show
                      when={(run().review ?? "").trim().length > 0}
                      fallback={
                        <p class="review-empty-state">
                          {run().status === "running" || run().status === "queued"
                            ? "Waiting for description tokens..."
                            : "No high-level description available for this run."}
                        </p>
                      }
                    >
                      <article class="review-suggestion-card">
                        <p class="review-suggestion-text text-[13px] leading-6 text-neutral-200">
                          {formatReviewMessage(run().review ?? "", 12_000)}
                        </p>
                      </article>
                    </Show>

                    <Show when={model.reviewRuns().length > 1}>
                      <div class="mt-3 border-t border-white/[0.06] pt-3">
                        <p class="mb-2 text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                          Recent runs
                        </p>
                        <div class="space-y-2">
                          <For each={model.reviewRuns().slice(0, 6)}>
                            {(historyRun) => (
                              <button
                                type="button"
                                class={`review-run-row ${model.selectedRunId() === historyRun.id ? "is-active" : ""}`}
                                onClick={() => model.setSelectedRunId(historyRun.id)}
                              >
                                <div class="mb-1 flex items-center justify-between gap-2">
                                  <p class="truncate text-[12px] text-neutral-200">{historyRun.scopeLabel}</p>
                                  <span class="text-[11px] text-neutral-500">
                                    {historyRun.findings.length}
                                  </span>
                                </div>
                                <p class="text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                                  {formatRunTime(historyRun.startedAt)}
                                </p>
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
              </section>
            </Show>

            <Show when={model.reviewWorkbenchTab() === "issues"}>
              <section
                id="review-workbench-panel-issues"
                role="tabpanel"
                aria-labelledby="review-workbench-tab-issues"
                tabIndex={0}
              >
              <div class="mb-2 flex items-center justify-between text-[12px] text-neutral-500">
                <span>
                  {issueFileCards().length} files • {visibleFindings().length} findings
                </span>
                <Show when={selectedRun()}>
                  {(run) => (
                    <span class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-neutral-400">
                      {run().status}
                    </span>
                  )}
                </Show>
              </div>

              <Show when={visibleProgressEvents().length > 0}>
                <div class="mb-2 max-h-[7rem] space-y-1.5 overflow-y-auto rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2">
                  <For each={visibleProgressEvents().slice(Math.max(0, visibleProgressEvents().length - 8))}>
                    {(event) => (
                      <p class="review-stream-message text-[12px] text-neutral-500">
                        {formatReviewMessage(event.message, 900)}
                      </p>
                    )}
                  </For>
                </div>
              </Show>

              <Show
                when={issueFileCards().length > 0}
                fallback={<p class="review-empty-state">{issuesEmptyMessage()}</p>}
              >
                <div class="space-y-2 overflow-y-auto pr-1">
                  <Show when={flaggedIssueFileCards().length > 0}>
                    <>
                      <p class="px-1 text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                        Files with issues ({flaggedIssueFileCards().length})
                      </p>
                      <For each={flaggedIssueFileCards()}>
                        {(card) => renderIssueFileCard(card)}
                      </For>
                    </>
                  </Show>
                  <Show when={cleanIssueFileCards().length > 0}>
                    <>
                      <p class="px-1 pt-1 text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                        Files without issues ({cleanIssueFileCards().length})
                      </p>
                      <For each={cleanIssueFileCards()}>
                        {(card) => renderIssueFileCard(card)}
                      </For>
                    </>
                  </Show>
                </div>
              </Show>
              </section>
            </Show>

            <Show when={model.reviewWorkbenchTab() === "chat"}>
              <section
                id="review-workbench-panel-chat"
                role="tabpanel"
                aria-labelledby="review-workbench-tab-chat"
                tabIndex={0}
                class="review-chat-panel"
              >
              <Show when={model.aiReviewBusy()}>
                <p class="mb-3 text-[12px] text-neutral-500">
                  Issue scan is running. Chat stays available while findings stream in.
                </p>
              </Show>
              <div class="review-chat-messages">
                <For each={(model.threadMessages() ?? []).slice(-14)}>
                  {(message) => (
                    <div
                      class={`rounded-md px-2.5 py-2 text-[12.5px] leading-5 ${message.role === "assistant" ? "bg-emerald-500/8 text-emerald-100/85" : "bg-white/[0.035] text-neutral-300"}`}
                    >
                      <p class="mb-1 text-[10px] uppercase tracking-[0.08em] text-neutral-500">{message.role}</p>
                      <p>{message.content}</p>
                    </div>
                  )}
                </For>
                <Show when={(model.threadMessages() ?? []).length === 0}>
                  <p class="px-1 py-1 text-[12px] text-neutral-500">
                    No conversation yet. Ask about the active diff scope to get started.
                  </p>
                </Show>
              </div>
              <Show when={model.threadMessagesLoadError()}>
                {(message) => (
                  <p class="mb-2 text-[12px] text-rose-300/90">
                    Unable to refresh conversation history: {message()}
                  </p>
                )}
              </Show>
              <Show when={model.aiSharedDiffContexts().length > 0}>
                <div class="mb-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2">
                  <div class="mb-1.5 flex items-center justify-between gap-2">
                    <p class="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-100/90">
                      Attached sections ({model.aiSharedDiffContexts().length})
                    </p>
                    <button
                      type="button"
                      class="review-inline-action shrink-0"
                      onClick={() => model.setAiSharedDiffContexts([])}
                    >
                      Clear all
                    </button>
                  </div>
                  <div class="space-y-1.5">
                    <For each={model.aiSharedDiffContexts()}>
                      {(context) => (
                        <div class="flex items-center justify-between gap-2 rounded border border-amber-200/20 bg-black/10 px-2.5 py-1.5">
                          <p class="min-w-0 truncate text-[11px] text-amber-100/90">
                            {getPathLeaf(context.filePath)}
                            {context.lineLabel ? ` ${context.lineLabel}` : ""}
                          </p>
                          <button
                            type="button"
                            class="review-inline-action shrink-0"
                            onClick={() =>
                              model.setAiSharedDiffContexts((current) =>
                                current.filter((candidate) => candidate.id !== context.id)
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <form
                class="review-chat-composer"
                onSubmit={(event) => void model.handleAskAiFollowUp(event)}
              >
                <div class="relative">
                  <TextField>
                    <TextFieldInput
                      ref={(element: HTMLInputElement | undefined) => {
                        chatPromptInputRef = element;
                      }}
                      value={model.aiPrompt()}
                      onInput={(event) => {
                        model.setAiPrompt(event.currentTarget.value);
                        setChatPromptCursorPosition(
                          event.currentTarget.selectionStart ?? event.currentTarget.value.length
                        );
                      }}
                      onClick={syncChatPromptCursorPosition}
                      onKeyUp={syncChatPromptCursorPosition}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key !== "Tab") return;
                        const suggestion = mentionSuggestions()[0];
                        if (!suggestion) return;
                        event.preventDefault();
                        applyMentionSuggestion(suggestion);
                      }}
                      placeholder={
                        model.aiReviewBusy()
                          ? "Ask while scanning: explain risks, fixes, or design intent..."
                          : "Ask about this diff, findings, or implementation choices..."
                      }
                      class="review-chat-input h-12 border-0 bg-transparent px-4 text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:ring-0 focus:ring-offset-0"
                    />
                  </TextField>
                  <Show when={activeChatMention()}>
                    <div class="absolute inset-x-2 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-lg border border-white/[0.09] bg-neutral-950/95 shadow-[0_10px_34px_rgba(0,0,0,0.5)]">
                      <Show
                        when={mentionSuggestions().length > 0}
                        fallback={
                          <p class="px-3 py-2 text-[12px] text-neutral-500">No matching file in current diff.</p>
                        }
                      >
                        <For each={mentionSuggestions()}>
                          {(filePath) => (
                            <button
                              type="button"
                              class="flex w-full items-center justify-between gap-3 border-b border-white/[0.04] px-3 py-2 text-left text-[12px] text-neutral-200 transition-colors last:border-b-0 hover:bg-white/[0.06]"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => applyMentionSuggestion(filePath)}
                            >
                              <span class="truncate font-medium">{getPathLeaf(filePath)}</span>
                              <span class="max-w-[60%] truncate text-[11px] text-neutral-500">{filePath}</span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
                <div class="flex items-center justify-between px-4 py-2.5">
                  <div class="flex items-center gap-2">
                    <Popover.Root
                      open={model.branchPopoverOpen()}
                      onOpenChange={model.setBranchPopoverOpen}
                      placement="top-start"
                      gutter={8}
                    >
                      <Popover.Trigger
                        as="button"
                        type="button"
                        class="branch-picker-trigger"
                        disabled={model.selectedWorkspace().length === 0}
                        aria-label="Switch current branch"
                        aria-expanded={model.branchPopoverOpen()}
                        aria-controls={branchPopoverContentId}
                      >
                        <GitBranch class="size-4 text-neutral-400" />
                        <span class="max-w-[8.75rem] truncate">
                          {model.workspaceBranchesLoading() && !model.workspaceBranches()
                            ? "Loading..."
                            : model.currentWorkspaceBranch()}
                        </span>
                        <ChevronRight class="size-3.5 rotate-90 text-neutral-500" />
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          id={branchPopoverContentId}
                          class="branch-picker-popover"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                        >
                          <div class="branch-picker-search">
                            <label for={branchSearchInputId} class="sr-only">
                              Search branches
                            </label>
                            <Search class="size-4 text-neutral-500" />
                            <input
                              id={branchSearchInputId}
                              ref={(element) => {
                                model.setBranchSearchInputRef(element);
                              }}
                              value={model.branchSearchQuery()}
                              onInput={(event) => model.setBranchSearchQuery(event.currentTarget.value)}
                              class="branch-picker-search-input"
                              placeholder="Search branches"
                              aria-label="Search branches"
                            />
                          </div>

                          <p class="branch-picker-section-label">Branches</p>
                          <div class="branch-picker-list">
                            <Show
                              when={!model.workspaceBranchesLoading()}
                              fallback={
                                <div class="branch-picker-loading">
                                  <LoaderCircle class="size-4 animate-spin text-neutral-500" />
                                  <span>Loading branches...</span>
                                </div>
                              }
                            >
                              <Show
                                when={model.filteredWorkspaceBranches().length > 0}
                                fallback={
                                  <p class="px-3 py-2 text-[13px] text-neutral-500">
                                    {model.workspaceBranchLoadError() ?? "No branches found."}
                                  </p>
                                }
                              >
                                <For each={model.filteredWorkspaceBranches()}>
                                  {(branch) => (
                                    <button
                                      type="button"
                                      class="branch-picker-item"
                                      disabled={model.branchActionBusy()}
                                      onClick={() => void model.handleCheckoutBranch(branch.name)}
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
                              when={!model.branchCreateMode()}
                              fallback={
                                <form
                                  class="branch-picker-create-form"
                                  onSubmit={(event) => void model.handleCreateAndCheckoutBranch(event)}
                                >
                                  <label for={branchCreateInputId} class="sr-only">
                                    New branch name
                                  </label>
                                  <input
                                    id={branchCreateInputId}
                                    ref={(element) => {
                                      model.setBranchCreateInputRef(element);
                                    }}
                                    value={model.newBranchName()}
                                    onInput={(event) => model.setNewBranchName(event.currentTarget.value)}
                                    class="branch-picker-create-input"
                                    placeholder="feature/new-branch"
                                    aria-label="New branch name"
                                  />
                                  <div class="flex items-center gap-2">
                                    <button
                                      type="button"
                                      class="branch-picker-create-cancel"
                                      onClick={() => {
                                        model.setBranchCreateMode(false);
                                        model.setNewBranchName("");
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      class="branch-picker-create-submit"
                                      disabled={!model.canCreateBranch()}
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
                                disabled={model.branchActionBusy()}
                                onClick={model.handleStartCreateBranch}
                              >
                                <PlusCircle class="size-4" />
                                <span>Create and checkout new branch...</span>
                              </button>
                            </Show>
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={
                      isFollowUpBusy() ||
                      model.compareBusy() ||
                      model.selectedWorkspace().length === 0 ||
                      model.aiPrompt().trim().length === 0
                    }
                    class="h-8 w-8 rounded-xl bg-amber-500/90 text-neutral-900 shadow-[0_0_12px_rgba(212,175,55,0.15)] hover:bg-amber-400/90 disabled:bg-neutral-700 disabled:text-neutral-400"
                  >
                    <Show
                      when={!isFollowUpBusy()}
                      fallback={<LoaderCircle class="size-3.5 animate-spin" />}
                    >
                      <Send class="size-3.5" />
                    </Show>
                  </Button>
                </div>
              </form>
              </section>
            </Show>
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
