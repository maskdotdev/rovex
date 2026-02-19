import type { Accessor, Setter } from "solid-js";
import {
  cancelAiReviewRun,
  checkoutWorkspaceBranch,
  compareWorkspaceDiff,
  createWorkspaceBranch,
  generateAiFollowUp,
  startAiReviewRun,
  type AiReviewChunk,
  type AiReviewFinding,
  type AiReviewProgressEvent,
  type CompareWorkspaceDiffResult,
} from "@/lib/backend";
import {
  buildScopedDiff,
  createFullReviewScope,
  getReviewScopeContext,
  getReviewScopeLabel,
  type ReviewScope,
} from "@/app/review-scope";
import type { ReviewRun, ReviewWorkbenchTab } from "@/app/review-types";

type UseReviewActionsArgs = {
  selection: {
    selectedThreadId: Accessor<number | null>;
    selectedWorkspace: Accessor<string>;
    selectedBaseRef: Accessor<string>;
    setSelectedBaseRef: Setter<string>;
  };
  compare: {
    compareResult: Accessor<CompareWorkspaceDiffResult | null>;
    setCompareResult: Setter<CompareWorkspaceDiffResult | null>;
    setCompareBusy: Setter<boolean>;
    setCompareError: Setter<string | null>;
    setShowDiffViewer: Setter<boolean>;
  };
  branch: {
    setBranchPopoverOpen: Setter<boolean>;
    setBranchCreateMode: Setter<boolean>;
    branchSearchQuery: Accessor<string>;
    newBranchName: Accessor<string>;
    setNewBranchName: Setter<string>;
    setBranchActionBusy: Setter<boolean>;
    setBranchActionError: Setter<string | null>;
    refetchWorkspaceBranches: () => unknown;
  };
  ai: {
    prompt: Accessor<string>;
    setPrompt: Setter<string>;
    setAiReviewBusy: Setter<boolean>;
    setAiFollowUpBusy?: Setter<boolean>;
    setAiReviewError: Setter<string | null>;
    setAiStatus: Setter<string | null>;
    setAiChunkReviews: Setter<AiReviewChunk[]>;
    setAiFindings: Setter<AiReviewFinding[]>;
    setAiProgressEvents: Setter<AiReviewProgressEvent[]>;
    refetchThreadMessages: () => unknown;
    refetchAiReviewRuns?: () => unknown;
  };
  review: {
    activeReviewScope: Accessor<ReviewScope>;
    setActiveReviewScope: Setter<ReviewScope>;
    setReviewRuns: Setter<ReviewRun[]>;
    setSelectedRunId: Setter<string | null>;
    setReviewWorkbenchTab: Setter<ReviewWorkbenchTab>;
  };
};

export function useReviewActions(args: UseReviewActionsArgs) {
  const { selection, compare, branch, ai, review } = args;
  let compareRequestSequence = 0;

  const setFollowUpBusy = (value: boolean) => {
    if (ai.setAiFollowUpBusy) {
      ai.setAiFollowUpBusy(value);
      return;
    }
    ai.setAiReviewBusy(value);
  };

  const resetComparisonView = () => {
    compare.setCompareError(null);
    compare.setCompareResult(null);
    compare.setShowDiffViewer(false);
  };

  const handleCheckoutBranch = async (branchName: string) => {
    const workspace = selection.selectedWorkspace().trim();
    const normalizedBranchName = branchName.trim();
    if (!workspace) {
      branch.setBranchActionError("Select a review with a local workspace before switching branches.");
      return;
    }
    if (!normalizedBranchName) return;

    branch.setBranchActionBusy(true);
    branch.setBranchActionError(null);
    try {
      await checkoutWorkspaceBranch({
        workspace,
        branchName: normalizedBranchName,
      });
      await branch.refetchWorkspaceBranches();
      branch.setBranchPopoverOpen(false);
      branch.setBranchCreateMode(false);
      branch.setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      branch.setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      branch.setBranchActionBusy(false);
    }
  };

  const handleStartCreateBranch = () => {
    branch.setBranchCreateMode(true);
    branch.setNewBranchName(branch.branchSearchQuery().trim());
  };

  const handleCreateAndCheckoutBranch = async (event: Event) => {
    event.preventDefault();
    const workspace = selection.selectedWorkspace().trim();
    const branchName = branch.newBranchName().trim();
    if (!workspace) {
      branch.setBranchActionError("Select a review with a local workspace before creating a branch.");
      return;
    }
    if (!branchName) {
      branch.setBranchActionError("Branch name must not be empty.");
      return;
    }

    branch.setBranchActionBusy(true);
    branch.setBranchActionError(null);
    try {
      await createWorkspaceBranch({
        workspace,
        branchName,
      });
      await branch.refetchWorkspaceBranches();
      branch.setBranchPopoverOpen(false);
      branch.setBranchCreateMode(false);
      branch.setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      branch.setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      branch.setBranchActionBusy(false);
    }
  };

  const handleCompareSelectedReview = async (target: { baseRef?: string; fetchRemote?: boolean } = {}) => {
    const requestSequence = ++compareRequestSequence;
    const threadIdAtStart = selection.selectedThreadId();
    const baseRef = target.baseRef?.trim() || selection.selectedBaseRef().trim() || "origin/main";
    const fetchRemote = target.fetchRemote ?? baseRef.startsWith("origin/");
    compare.setCompareError(null);

    const workspace = selection.selectedWorkspace().trim();
    if (!workspace) {
      compare.setCompareError("Select a review that has a local workspace path.");
      return;
    }

    compare.setCompareBusy(true);
    try {
      const result = await compareWorkspaceDiff({
        workspace,
        baseRef,
        fetchRemote,
      });
      if (requestSequence !== compareRequestSequence) {
        return;
      }
      if (threadIdAtStart !== selection.selectedThreadId()) {
        return;
      }
      selection.setSelectedBaseRef(result.baseRef);
      compare.setCompareResult(result);
      compare.setShowDiffViewer(true);
    } catch (error) {
      if (requestSequence !== compareRequestSequence) {
        return;
      }
      compare.setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestSequence === compareRequestSequence) {
        compare.setCompareBusy(false);
      }
    }
  };

  const handleOpenDiffViewer = async () => {
    if (compare.compareResult()) {
      compare.setShowDiffViewer((current) => !current);
      return;
    }

    await handleCompareSelectedReview();
  };

  const handleStartAiReview = async (scopeOverride?: ReviewScope) => {
    ai.setAiReviewError(null);
    ai.setAiStatus(null);
    ai.setAiChunkReviews([]);
    ai.setAiFindings([]);
    ai.setAiProgressEvents([]);

    const threadId = selection.selectedThreadId();
    if (threadId == null) {
      ai.setAiReviewError("Select a review before running AI.");
      return;
    }

    let comparison = compare.compareResult();
    if (!comparison) {
      await handleCompareSelectedReview();
      comparison = compare.compareResult();
    }

    if (!comparison) {
      ai.setAiReviewError("Load a diff before running AI review.");
      return;
    }

    const scope = scopeOverride ?? review.activeReviewScope();
    const scopedDiff = buildScopedDiff(comparison.diff, scope);
    if (!scopedDiff) {
      ai.setAiReviewError("No changes found in the selected scope.");
      return;
    }

    const optimisticRunId = `run-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runLabel = getReviewScopeLabel(scope);
    const startedAt = Date.now();
    review.setReviewRuns((current) => [
      {
        id: optimisticRunId,
        status: "queued",
        scope,
        scopeLabel: runLabel,
        startedAt,
        endedAt: null,
        model: null,
        diffTruncated: false,
        error: null,
        progressEvents: [],
        chunks: [],
        findings: [],
      },
      ...current,
    ]);
    review.setSelectedRunId(optimisticRunId);
    review.setActiveReviewScope(scope);
    review.setReviewWorkbenchTab("issues");

    ai.setAiReviewBusy(false);
    ai.setAiStatus(`Queueing review on ${runLabel}...`);
    try {
      const response = await startAiReviewRun({
        threadId,
        workspace: comparison.workspace,
        baseRef: comparison.baseRef,
        mergeBase: comparison.mergeBase,
        head: comparison.head,
        filesChanged: scopedDiff.filesChanged,
        insertions: scopedDiff.insertions,
        deletions: scopedDiff.deletions,
        diff: scopedDiff.diff,
        prompt: ai.prompt().trim() || null,
        scopeLabel: runLabel,
      });
      ai.setPrompt("");
      review.setReviewRuns((current) =>
        current.map((run) =>
          run.id !== optimisticRunId
            ? run
            : {
                ...run,
                id: response.run.runId,
                status: response.run.status === "queued" ? "queued" : "running",
                startedAt: Date.parse(response.run.createdAt) || run.startedAt,
              }
        )
      );
      review.setSelectedRunId(response.run.runId);
      ai.setAiStatus(`Review queued on ${runLabel}.`);
      await ai.refetchAiReviewRuns?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ai.setAiReviewError(message);
      review.setReviewRuns((current) =>
        current.map((run) =>
          run.id !== optimisticRunId
            ? run
            : {
                ...run,
                status: "failed",
                endedAt: Date.now(),
                error: message,
              }
        )
      );
    }
  };

  const handleStartAiReviewOnFullDiff = async () => {
    await handleStartAiReview(createFullReviewScope());
  };

  const handleCancelAiReviewRun = async (runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;

    try {
      const response = await cancelAiReviewRun({ runId: normalizedRunId });
      review.setReviewRuns((current) =>
        current.map((run) =>
          run.id !== normalizedRunId
            ? run
            : {
                ...run,
                status:
                  response.status === "canceled" ? "canceled" : (run.status as ReviewRun["status"]),
                endedAt: response.status === "canceled" ? Date.now() : run.endedAt,
              }
        )
      );
      await ai.refetchAiReviewRuns?.();
      if (response.canceled) {
        ai.setAiStatus(
          response.status === "canceled"
            ? "Review run canceled."
            : "Cancel request sent for running review."
        );
      }
    } catch (error) {
      ai.setAiReviewError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAskAiFollowUp = async (event: Event) => {
    event.preventDefault();
    ai.setAiReviewError(null);
    ai.setAiStatus(null);

    const threadId = selection.selectedThreadId();
    if (threadId == null) {
      ai.setAiReviewError("Select a review before asking questions.");
      return;
    }

    const workspace = selection.selectedWorkspace().trim();
    if (!workspace) {
      ai.setAiReviewError("Select a review that has a local workspace path.");
      return;
    }

    const question = ai.prompt().trim();
    if (!question) {
      ai.setAiReviewError("Type a follow-up question.");
      return;
    }

    const scopedQuestion = `${question}\n\n[Review context]\n${getReviewScopeContext(review.activeReviewScope())}`;

    setFollowUpBusy(true);
    ai.setAiStatus("Sending follow-up question...");
    try {
      const response = await generateAiFollowUp({
        threadId,
        workspace,
        question: scopedQuestion,
      });
      await ai.refetchThreadMessages();
      ai.setPrompt("");
      ai.setAiStatus(`Answered with ${response.model}.`);
    } catch (error) {
      ai.setAiReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setFollowUpBusy(false);
    }
  };

  return {
    handleCheckoutBranch,
    handleStartCreateBranch,
    handleCreateAndCheckoutBranch,
    handleCompareSelectedReview,
    handleOpenDiffViewer,
    handleStartAiReview,
    handleStartAiReviewOnFullDiff,
    handleCancelAiReviewRun,
    handleAskAiFollowUp,
  };
}
