import { createAiReviewActions } from "@/app/hooks/review-actions/ai-review-actions";
import { createBranchAndCompareActions } from "@/app/hooks/review-actions/branch-and-compare-actions";
import type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

export type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

export function useReviewActions(args: UseReviewActionsArgs) {
  const branchAndCompareActions = createBranchAndCompareActions({
    selection: args.selection,
    compare: args.compare,
    branch: args.branch,
  });

  const aiReviewActions = createAiReviewActions({
    selection: args.selection,
    compare: args.compare,
    ai: args.ai,
    review: args.review,
    handleCompareSelectedReview: branchAndCompareActions.handleCompareSelectedReview,
  });

  return {
    ...branchAndCompareActions,
    ...aiReviewActions,
  };
}
