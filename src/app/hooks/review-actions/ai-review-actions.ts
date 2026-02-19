import { cancelAiReviewRun, generateAiFollowUp, startAiReviewRun } from "@/lib/backend";
import {
  buildScopedDiff,
  createFullReviewScope,
  getReviewScopeContext,
  getReviewScopeLabel,
  type ReviewScope,
} from "@/app/review-scope";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { ReviewRun } from "@/app/review-types";
import type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

type AiReviewActionsArgs = Pick<
  UseReviewActionsArgs,
  "selection" | "compare" | "ai" | "review"
> & {
  handleCompareSelectedReview: (target?: { baseRef?: string; fetchRemote?: boolean }) => Promise<void>;
};

export function createAiReviewActions(args: AiReviewActionsArgs) {
  const { selection, compare, ai, review, handleCompareSelectedReview } = args;

  const setFollowUpBusy = (value: boolean) => {
    if (ai.setAiFollowUpBusy) {
      ai.setAiFollowUpBusy(value);
      return;
    }
    ai.setAiReviewBusy(value);
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
      const message = toErrorMessage(error);
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
      ai.setAiReviewError(toErrorMessage(error));
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
      ai.setAiReviewError(toErrorMessage(error));
    } finally {
      setFollowUpBusy(false);
    }
  };

  return {
    handleStartAiReview,
    handleStartAiReviewOnFullDiff,
    handleCancelAiReviewRun,
    handleAskAiFollowUp,
  };
}
