import {
  checkoutWorkspaceBranch,
  compareWorkspaceDiff,
  createWorkspaceBranch,
  listInlineReviewComments,
} from "@/lib/backend";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

type BranchAndCompareActionsArgs = Pick<
  UseReviewActionsArgs,
  "selection" | "compare" | "branch" | "comments"
>;

export function createBranchAndCompareActions(args: BranchAndCompareActionsArgs) {
  const { selection, compare, branch, comments } = args;
  let compareRequestSequence = 0;

  const resetComparisonView = () => {
    compare.setCompareError(null);
    compare.setCompareResult(null);
    compare.setShowDiffViewer(false);
    comments.setInlineReviewComments([]);
  };

  const finalizeBranchSwitch = async () => {
    await branch.refetchWorkspaceBranches();
    branch.setBranchPopoverOpen(false);
    branch.setBranchCreateMode(false);
    branch.setNewBranchName("");
    resetComparisonView();
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
      await finalizeBranchSwitch();
    } catch (error) {
      branch.setBranchActionError(toErrorMessage(error));
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
      await finalizeBranchSwitch();
    } catch (error) {
      branch.setBranchActionError(toErrorMessage(error));
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
    if (threadIdAtStart == null) {
      compare.setCompareError("Select a review before loading workspace changes.");
      comments.setInlineReviewComments([]);
      return;
    }
    if (!workspace) {
      compare.setCompareError("Select a review that has a local workspace path.");
      comments.setInlineReviewComments([]);
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
      try {
        const inlineCommentsResult = await listInlineReviewComments({
          threadId: threadIdAtStart,
          workspace: result.workspace,
          baseRef: result.baseRef,
          mergeBase: result.mergeBase,
          head: result.head,
        });
        if (requestSequence !== compareRequestSequence) {
          return;
        }
        if (threadIdAtStart !== selection.selectedThreadId()) {
          return;
        }
        comments.setInlineReviewComments(inlineCommentsResult.comments);
      } catch (error) {
        console.error("[rovex review] Failed to load inline review comments:", error);
        comments.setInlineReviewComments([]);
      }
    } catch (error) {
      if (requestSequence !== compareRequestSequence) {
        return;
      }
      comments.setInlineReviewComments([]);
      compare.setCompareError(toErrorMessage(error));
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

  return {
    handleCheckoutBranch,
    handleStartCreateBranch,
    handleCreateAndCheckoutBranch,
    handleCompareSelectedReview,
    handleOpenDiffViewer,
  };
}
