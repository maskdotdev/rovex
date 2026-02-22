import type { Accessor, Setter } from "solid-js";
import type {
  AiReviewChunk,
  AiReviewFinding,
  AiReviewProgressEvent,
  CompareWorkspaceDiffResult,
  InlineReviewComment,
} from "@/lib/backend";
import type { FileOpenWith } from "@/app/types";
import type { ReviewScope } from "@/app/review-scope";
import type {
  ReviewChatSharedDiffContext,
  ReviewRun,
  ReviewWorkbenchTab,
} from "@/app/review-types";

export type UseReviewActionsArgs = {
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
  comments: {
    inlineReviewComments: Accessor<InlineReviewComment[]>;
    setInlineReviewComments: Setter<InlineReviewComment[]>;
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
  editor: {
    fileOpenWith: Accessor<FileOpenWith>;
    ghosttyOpenCommand: Accessor<string>;
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
    sharedDiffContexts: Accessor<ReviewChatSharedDiffContext[]>;
    setSharedDiffContexts: Setter<ReviewChatSharedDiffContext[]>;
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
