import type { Accessor, Setter } from "solid-js";
import {
  checkoutWorkspaceBranch,
  compareWorkspaceDiff,
  createWorkspaceBranch,
  generateAiFollowUp,
  generateAiReview,
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
  selectedThreadId: Accessor<number | null>;
  selectedWorkspace: Accessor<string>;
  selectedBaseRef: Accessor<string>;
  setSelectedBaseRef: Setter<string>;
  compareResult: Accessor<CompareWorkspaceDiffResult | null>;
  setCompareResult: Setter<CompareWorkspaceDiffResult | null>;
  setCompareBusy: Setter<boolean>;
  setCompareError: Setter<string | null>;
  setShowDiffViewer: Setter<boolean>;
  setBranchPopoverOpen: Setter<boolean>;
  setBranchCreateMode: Setter<boolean>;
  branchSearchQuery: Accessor<string>;
  newBranchName: Accessor<string>;
  setNewBranchName: Setter<string>;
  setBranchActionBusy: Setter<boolean>;
  setBranchActionError: Setter<string | null>;
  refetchWorkspaceBranches: () => unknown;
  aiPrompt: Accessor<string>;
  setAiPrompt: Setter<string>;
  hasReviewStarted?: Accessor<boolean>;
  setAiReviewBusy: Setter<boolean>;
  setAiFollowUpBusy?: Setter<boolean>;
  setAiReviewError: Setter<string | null>;
  setAiStatus: Setter<string | null>;
  setAiChunkReviews: Setter<AiReviewChunk[]>;
  setAiFindings: Setter<AiReviewFinding[]>;
  setAiProgressEvents: Setter<AiReviewProgressEvent[]>;
  refetchThreadMessages: () => unknown;
  activeReviewScope: Accessor<ReviewScope>;
  setActiveReviewScope: Setter<ReviewScope>;
  setReviewRuns: Setter<ReviewRun[]>;
  setSelectedRunId: Setter<string | null>;
  setReviewWorkbenchTab: Setter<ReviewWorkbenchTab>;
};

export function useReviewActions(args: UseReviewActionsArgs) {
  const setFollowUpBusy = (value: boolean) => {
    if (args.setAiFollowUpBusy) {
      args.setAiFollowUpBusy(value);
      return;
    }
    args.setAiReviewBusy(value);
  };

  const resetComparisonView = () => {
    args.setCompareError(null);
    args.setCompareResult(null);
    args.setShowDiffViewer(false);
  };

  const handleCheckoutBranch = async (branchName: string) => {
    const workspace = args.selectedWorkspace().trim();
    const normalizedBranchName = branchName.trim();
    if (!workspace) {
      args.setBranchActionError("Select a review with a local workspace before switching branches.");
      return;
    }
    if (!normalizedBranchName) return;

    args.setBranchActionBusy(true);
    args.setBranchActionError(null);
    try {
      await checkoutWorkspaceBranch({
        workspace,
        branchName: normalizedBranchName,
      });
      await args.refetchWorkspaceBranches();
      args.setBranchPopoverOpen(false);
      args.setBranchCreateMode(false);
      args.setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      args.setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setBranchActionBusy(false);
    }
  };

  const handleStartCreateBranch = () => {
    args.setBranchCreateMode(true);
    args.setNewBranchName(args.branchSearchQuery().trim());
  };

  const handleCreateAndCheckoutBranch = async (event: Event) => {
    event.preventDefault();
    const workspace = args.selectedWorkspace().trim();
    const branchName = args.newBranchName().trim();
    if (!workspace) {
      args.setBranchActionError("Select a review with a local workspace before creating a branch.");
      return;
    }
    if (!branchName) {
      args.setBranchActionError("Branch name must not be empty.");
      return;
    }

    args.setBranchActionBusy(true);
    args.setBranchActionError(null);
    try {
      await createWorkspaceBranch({
        workspace,
        branchName,
      });
      await args.refetchWorkspaceBranches();
      args.setBranchPopoverOpen(false);
      args.setBranchCreateMode(false);
      args.setNewBranchName("");
      resetComparisonView();
    } catch (error) {
      args.setBranchActionError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setBranchActionBusy(false);
    }
  };

  const handleCompareSelectedReview = async (target: { baseRef?: string; fetchRemote?: boolean } = {}) => {
    const baseRef = target.baseRef?.trim() || args.selectedBaseRef().trim() || "main";
    const fetchRemote = target.fetchRemote ?? false;
    args.setCompareError(null);

    const workspace = args.selectedWorkspace();
    if (!workspace) {
      args.setCompareError("Select a review that has a local workspace path.");
      return;
    }

    args.setCompareBusy(true);
    try {
      const result = await compareWorkspaceDiff({
        workspace,
        baseRef,
        fetchRemote,
      });
      args.setSelectedBaseRef(result.baseRef);
      args.setCompareResult(result);
      args.setShowDiffViewer(true);
    } catch (error) {
      args.setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      args.setCompareBusy(false);
    }
  };

  const handleOpenDiffViewer = async () => {
    if (args.compareResult()) {
      args.setShowDiffViewer((current) => !current);
      return;
    }

    await handleCompareSelectedReview();
  };

  const handleStartAiReview = async (scopeOverride?: ReviewScope) => {
    args.setAiReviewError(null);
    args.setAiStatus(null);
    args.setAiChunkReviews([]);
    args.setAiFindings([]);
    args.setAiProgressEvents([]);

    const threadId = args.selectedThreadId();
    if (threadId == null) {
      args.setAiReviewError("Select a review before running AI.");
      return;
    }

    let comparison = args.compareResult();
    if (!comparison) {
      await handleCompareSelectedReview();
      comparison = args.compareResult();
    }

    if (!comparison) {
      args.setAiReviewError("Load a diff before running AI review.");
      return;
    }

    const scope = scopeOverride ?? args.activeReviewScope();
    const scopedDiff = buildScopedDiff(comparison.diff, scope);
    if (!scopedDiff) {
      args.setAiReviewError("No changes found in the selected scope.");
      return;
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runLabel = getReviewScopeLabel(scope);
    const startedAt = Date.now();
    args.setReviewRuns((current) => [
      {
        id: runId,
        status: "running",
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
    args.setSelectedRunId(runId);
    args.setActiveReviewScope(scope);
    args.setReviewWorkbenchTab("issues");

    args.setAiReviewBusy(true);
    args.setAiStatus(`Starting chunked review on ${runLabel}...`);
    try {
      const response = await generateAiReview({
        threadId,
        workspace: comparison.workspace,
        baseRef: comparison.baseRef,
        mergeBase: comparison.mergeBase,
        head: comparison.head,
        filesChanged: scopedDiff.filesChanged,
        insertions: scopedDiff.insertions,
        deletions: scopedDiff.deletions,
        diff: scopedDiff.diff,
        prompt: args.aiPrompt().trim() || null,
      });
      await args.refetchThreadMessages();
      args.setAiPrompt("");
      args.setAiChunkReviews(response.chunks);
      args.setAiFindings(response.findings);
      args.setReviewRuns((current) =>
        current.map((run) =>
          run.id !== runId
            ? run
            : {
                ...run,
                status: "completed",
                endedAt: Date.now(),
                model: response.model,
                diffTruncated: response.diffTruncated,
                chunks: response.chunks,
                findings: response.findings,
              }
        )
      );
      args.setAiStatus(
        `Reviewed ${runLabel}: ${response.chunks.length} chunk(s), ${response.findings.length} finding(s) via ${response.model}${response.diffTruncated ? " (truncated chunk input)." : "."}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      args.setAiReviewError(message);
      args.setReviewRuns((current) =>
        current.map((run) =>
          run.id !== runId
            ? run
            : {
                ...run,
                status: "failed",
                endedAt: Date.now(),
                error: message,
              }
        )
      );
    } finally {
      args.setAiReviewBusy(false);
    }
  };

  const handleStartAiReviewOnFullDiff = async () => {
    await handleStartAiReview(createFullReviewScope());
  };

  const handleAskAiFollowUp = async (event: Event) => {
    event.preventDefault();
    args.setAiReviewError(null);
    args.setAiStatus(null);

    const threadId = args.selectedThreadId();
    if (threadId == null) {
      args.setAiReviewError("Select a review before asking questions.");
      return;
    }

    const workspace = args.selectedWorkspace().trim();
    if (!workspace) {
      args.setAiReviewError("Select a review that has a local workspace path.");
      return;
    }

    const question = args.aiPrompt().trim();
    if (!question) {
      args.setAiReviewError("Type a follow-up question.");
      return;
    }

    const scopedQuestion = `${question}\n\n[Review context]\n${getReviewScopeContext(args.activeReviewScope())}`;

    setFollowUpBusy(true);
    args.setAiStatus("Sending follow-up question...");
    try {
      const response = await generateAiFollowUp({
        threadId,
        workspace,
        question: scopedQuestion,
      });
      await args.refetchThreadMessages();
      args.setAiPrompt("");
      args.setAiStatus(`Answered with ${response.model}.`);
    } catch (error) {
      args.setAiReviewError(error instanceof Error ? error.message : String(error));
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
    handleAskAiFollowUp,
  };
}
