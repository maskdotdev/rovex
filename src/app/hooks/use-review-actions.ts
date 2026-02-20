import { createAiReviewActions } from "@/app/hooks/review-actions/ai-review-actions";
import { createBranchAndCompareActions } from "@/app/hooks/review-actions/branch-and-compare-actions";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";
import type { DiffViewerCreateInlineCommentInput } from "@/components/diff-viewer";
import { createInlineReviewComment, openFileInEditor } from "@/lib/backend";

export type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

export function useReviewActions(args: UseReviewActionsArgs) {
  const branchAndCompareActions = createBranchAndCompareActions({
    selection: args.selection,
    compare: args.compare,
    branch: args.branch,
    comments: args.comments,
  });

  const aiReviewActions = createAiReviewActions({
    selection: args.selection,
    compare: args.compare,
    ai: args.ai,
    review: args.review,
    handleCompareSelectedReview: branchAndCompareActions.handleCompareSelectedReview,
  });

  const handleOpenFileInEditor = async (filePath: string) => {
    const workspace = args.selection.selectedWorkspace().trim();
    const normalizedFilePath = filePath.trim();

    if (!workspace) {
      args.ai.setAiReviewError("Select a review with a local workspace before opening files.");
      return;
    }
    if (!normalizedFilePath) {
      args.ai.setAiReviewError("Unable to determine which file to open.");
      return;
    }

    const launcher = args.editor.fileOpenWith();
    const ghosttyCommand = args.editor.ghosttyOpenCommand().trim();
    args.ai.setAiReviewError(null);
    try {
      await openFileInEditor({
        workspace,
        filePath: normalizedFilePath,
        launcher,
        ghosttyCommandTemplate:
          launcher === "ghostty" ? (ghosttyCommand.length > 0 ? ghosttyCommand : null) : null,
      });
      args.ai.setAiStatus(`Opened ${normalizedFilePath} in ${launcher}.`);
    } catch (error) {
      args.ai.setAiReviewError(toErrorMessage(error));
    }
  };

  const handleCreateInlineReviewComment = async (
    input: DiffViewerCreateInlineCommentInput
  ) => {
    const threadId = args.selection.selectedThreadId();
    if (threadId == null) {
      args.ai.setAiReviewError("Select a review before creating inline comments.");
      return;
    }

    const compareResult = args.compare.compareResult();
    if (!compareResult) {
      args.ai.setAiReviewError("Load workspace changes before creating inline comments.");
      return;
    }

    const filePath = input.filePath.trim();
    const body = input.body.trim();
    if (!filePath || !body) return;
    const side = input.side === "deletions" ? "deletions" : "additions";
    const lineNumber = Number.isFinite(input.lineNumber)
      ? Math.max(1, Math.floor(input.lineNumber))
      : 0;
    if (lineNumber <= 0) return;
    const normalizedEndLineNumber =
      input.endLineNumber != null && Number.isFinite(input.endLineNumber)
        ? Math.max(1, Math.floor(input.endLineNumber))
        : lineNumber;
    const rangeStart = Math.min(lineNumber, normalizedEndLineNumber);
    const rangeEnd = Math.max(lineNumber, normalizedEndLineNumber);
    const hasRange = rangeEnd > rangeStart;

    try {
      const created = await createInlineReviewComment({
        threadId,
        workspace: compareResult.workspace,
        baseRef: compareResult.baseRef,
        mergeBase: compareResult.mergeBase,
        head: compareResult.head,
        filePath,
        side,
        lineNumber: rangeStart,
        endSide: hasRange ? side : null,
        endLineNumber: hasRange ? rangeEnd : null,
        body,
        author: "You",
      });
      args.comments.setInlineReviewComments((current) => [...current, created]);
      args.ai.setAiReviewError(null);
    } catch (error) {
      args.ai.setAiReviewError(toErrorMessage(error));
      throw error;
    }
  };

  return {
    ...branchAndCompareActions,
    ...aiReviewActions,
    handleOpenFileInEditor,
    handleCreateInlineReviewComment,
  };
}
