import { cancelAiReviewRun, generateAiFollowUp, startAiReviewRun } from "@/lib/backend";
import {
  buildScopedDiff,
  createFullReviewScope,
  getReviewScopeContext,
  getReviewScopeLabel,
  normalizeDiffPath,
  parsePatchFiles,
  type ReviewScope,
} from "@/app/review-scope";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { ReviewChatSharedDiffContext, ReviewRun } from "@/app/review-types";
import type { UseReviewActionsArgs } from "@/app/hooks/review-action-types";

type AiReviewActionsArgs = Pick<
  UseReviewActionsArgs,
  "selection" | "compare" | "ai" | "review"
> & {
  handleCompareSelectedReview: (target?: { baseRef?: string; fetchRemote?: boolean }) => Promise<void>;
};

const MAX_SHARED_DIFF_CHARS = 24_000;
const MAX_MENTIONED_FILES = 3;
const MAX_MENTIONED_DIFF_CHARS = 8_000;
const DIFF_MENTION_PATTERN = /(^|\s)@([^\s]+)/g;

function buildSharedDiffContextId(args: {
  filePath: string;
  lineLabel?: string | null;
  note?: string | null;
}) {
  const normalizedPath = normalizeDiffPath(args.filePath);
  const normalizedLineLabel = args.lineLabel?.trim() ?? "";
  const normalizedNote = args.note?.trim() ?? "";
  return `${normalizedPath}::${normalizedLineLabel}::${normalizedNote}`;
}

function parseLineLabelRange(lineLabel: string | null | undefined) {
  const normalizedLineLabel = lineLabel?.trim();
  if (!normalizedLineLabel) return null;
  const legacyMatch = /^L(\d+)(?:-L(\d+))?$/.exec(normalizedLineLabel);
  const colonMatch = /^(\d+):(\d+)$/.exec(normalizedLineLabel);
  if (!legacyMatch && !colonMatch) return null;
  const start = Number.parseInt(legacyMatch?.[1] ?? colonMatch?.[1] ?? "", 10);
  const end = Number.parseInt(legacyMatch?.[2] ?? colonMatch?.[2] ?? legacyMatch?.[1] ?? "", 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

export function extractDiffFileMentions(question: string): string[] {
  const mentions: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = DIFF_MENTION_PATTERN.exec(question)) != null) {
    const rawMention = match[2] ?? "";
    const cleanedMention = normalizeDiffPath(
      rawMention.replace(/^['"`([{<]+/, "").replace(/[.,!?;:)\]}>`"']+$/, "")
    );
    if (!cleanedMention || seen.has(cleanedMention)) continue;
    seen.add(cleanedMention);
    mentions.push(cleanedMention);
  }

  return mentions;
}

export type MentionedDiffContextResult = {
  contexts: ReviewChatSharedDiffContext[];
  unresolvedMentions: string[];
  ambiguousMentions: string[];
  omittedPaths: string[];
};

function uniqueDiffFilePaths(diff: string): string[] {
  const normalizedPaths = parsePatchFiles(diff)
    .map((file) => normalizeDiffPath(file.filePath))
    .filter((path): path is string => path.length > 0);
  return [...new Set(normalizedPaths)];
}

function resolveMentionToFilePath(mention: string, availablePaths: string[]): string | null {
  const normalizedMention = normalizeDiffPath(mention);
  if (!normalizedMention) return null;

  const exactMatches = availablePaths.filter((path) => path === normalizedMention);
  if (exactMatches.length === 1) return exactMatches[0] ?? null;
  if (exactMatches.length > 1) return null;

  const suffixMatches = availablePaths.filter(
    (path) => path.endsWith(`/${normalizedMention}`) || path === normalizedMention
  );
  if (suffixMatches.length === 1) return suffixMatches[0] ?? null;
  if (suffixMatches.length > 1) return null;

  if (normalizedMention.includes("/")) return null;

  const basenameMatches = availablePaths.filter((path) => {
    const parts = path.split("/");
    return parts[parts.length - 1] === normalizedMention;
  });
  if (basenameMatches.length === 1) return basenameMatches[0] ?? null;
  return null;
}

export function collectMentionedDiffContexts(
  diff: string,
  mentions: string[]
): MentionedDiffContextResult {
  const availablePaths = uniqueDiffFilePaths(diff);
  const resolvedPaths: string[] = [];
  const unresolvedMentions: string[] = [];
  const ambiguousMentions: string[] = [];

  for (const mention of mentions) {
    const normalizedMention = normalizeDiffPath(mention);
    if (!normalizedMention) continue;

    const exactMatches = availablePaths.filter((path) => path === normalizedMention);
    if (exactMatches.length > 1) {
      ambiguousMentions.push(normalizedMention);
      continue;
    }

    if (exactMatches.length === 0) {
      const suffixMatches = availablePaths.filter(
        (path) => path.endsWith(`/${normalizedMention}`) || path === normalizedMention
      );
      if (suffixMatches.length > 1) {
        ambiguousMentions.push(normalizedMention);
        continue;
      }
      if (suffixMatches.length === 0 && !normalizedMention.includes("/")) {
        const basenameMatches = availablePaths.filter((path) => {
          const parts = path.split("/");
          return parts[parts.length - 1] === normalizedMention;
        });
        if (basenameMatches.length > 1) {
          ambiguousMentions.push(normalizedMention);
          continue;
        }
        if (basenameMatches.length === 0) {
          unresolvedMentions.push(normalizedMention);
          continue;
        }
      }
    }

    const resolvedPath = resolveMentionToFilePath(normalizedMention, availablePaths);
    if (!resolvedPath) {
      unresolvedMentions.push(normalizedMention);
      continue;
    }
    if (resolvedPaths.includes(resolvedPath)) continue;
    resolvedPaths.push(resolvedPath);
  }

  const includedPaths = resolvedPaths.slice(0, MAX_MENTIONED_FILES);
  const omittedPaths = resolvedPaths.slice(MAX_MENTIONED_FILES);
  const contexts: ReviewChatSharedDiffContext[] = [];

  for (const filePath of includedPaths) {
    const scopedDiff = buildScopedDiff(diff, { kind: "file", filePath });
    if (!scopedDiff) continue;
    const rawDiff = scopedDiff.diff.trim();
    if (!rawDiff) continue;
    const truncated = rawDiff.length > MAX_MENTIONED_DIFF_CHARS;
    contexts.push({
      id: buildSharedDiffContextId({ filePath }),
      filePath,
      diff: truncated ? rawDiff.slice(0, MAX_MENTIONED_DIFF_CHARS) : rawDiff,
      truncated,
      lineLabel: null,
      lineStart: null,
      lineEnd: null,
      note: null,
    });
  }

  return {
    contexts,
    unresolvedMentions,
    ambiguousMentions,
    omittedPaths,
  };
}

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
        review: null,
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
      review.setReviewRuns((current) => {
        const optimistic = current.find((run) => run.id === optimisticRunId) ?? null;
        const existing = current.find((run) => run.id === response.run.runId) ?? null;
        const mergedRun: ReviewRun = {
          ...(optimistic ?? existing ?? {
            id: response.run.runId,
            status: "queued",
            scope,
            scopeLabel: runLabel,
            startedAt,
            endedAt: null,
            model: null,
            review: null,
            diffTruncated: false,
            error: null,
            progressEvents: [],
            chunks: [],
            findings: [],
          }),
          id: response.run.runId,
          status: response.run.status === "queued" ? "queued" : "running",
          startedAt:
            Date.parse(response.run.startedAt ?? response.run.createdAt) ||
            optimistic?.startedAt ||
            existing?.startedAt ||
            startedAt,
          endedAt: null,
          error: null,
        };

        const remaining = current.filter(
          (run) => run.id !== optimisticRunId && run.id !== response.run.runId
        );
        return [mergedRun, ...remaining];
      });
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

  const handlePrepareAiFollowUpForFile = (
    filePath: string,
    contextNote?: string,
    lineLabel?: string
  ) => {
    ai.setAiReviewError(null);
    ai.setAiStatus(null);

    const normalizedFilePath = normalizeDiffPath(filePath);
    if (!normalizedFilePath) {
      ai.setAiReviewError("Unable to locate file path for AI sharing.");
      return;
    }

    const comparison = compare.compareResult();
    if (!comparison) {
      ai.setAiReviewError("Load a diff before sharing a file with chat.");
      return;
    }

    const scopedDiff = buildScopedDiff(comparison.diff, {
      kind: "file",
      filePath: normalizedFilePath,
    });
    if (!scopedDiff) {
      ai.setAiReviewError("Unable to extract that file from the current diff.");
      return;
    }

    const rawDiff = scopedDiff.diff.trim();
    const truncated = rawDiff.length > MAX_SHARED_DIFF_CHARS;
    const contextDiff = truncated ? rawDiff.slice(0, MAX_SHARED_DIFF_CHARS) : rawDiff;
    const normalizedContextNote = contextNote?.trim() || null;
    const normalizedLineLabel = lineLabel?.trim() || null;
    const parsedRange = parseLineLabelRange(normalizedLineLabel);
    const nextContext: ReviewChatSharedDiffContext = {
      id: buildSharedDiffContextId({
        filePath: normalizedFilePath,
        lineLabel: normalizedLineLabel,
        note: normalizedContextNote,
      }),
      filePath: normalizedFilePath,
      diff: contextDiff,
      truncated,
      lineLabel: normalizedLineLabel,
      lineStart: parsedRange?.start ?? null,
      lineEnd: parsedRange?.end ?? null,
      note: normalizedContextNote,
    };

    ai.setSharedDiffContexts((current) => {
      const withoutDuplicate = current.filter((candidate) => candidate.id !== nextContext.id);
      return [...withoutDuplicate, nextContext];
    });
    review.setActiveReviewScope({
      kind: "file",
      filePath: normalizedFilePath,
    });
    review.setReviewWorkbenchTab("chat");
    ai.setPrompt((current) => {
      if (current.trim().length > 0) return current;
      if (normalizedContextNote && normalizedContextNote.length > 0) {
        return current;
      }
      return `Question about ${normalizedFilePath}: `;
    });
    const statusPrefix =
      truncated
        ? `Shared ${normalizedFilePath} diff with chat (trimmed for size).`
        : `Shared ${normalizedFilePath} diff with chat.`;
    ai.setAiStatus(
      normalizedLineLabel
        ? `${statusPrefix} Section ${normalizedLineLabel} added.`
        : statusPrefix
    );
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

    const mentionedFiles = extractDiffFileMentions(question);
    const sharedDiffContexts = ai.sharedDiffContexts();
    let mentionedContexts: ReviewChatSharedDiffContext[] = [];
    let mentionWarningText = "";

    if (mentionedFiles.length > 0) {
      const comparison = compare.compareResult();
      if (!comparison) {
        ai.setAiReviewError("Load a diff before using @file mentions in chat.");
        return;
      }
      const mentionResult = collectMentionedDiffContexts(comparison.diff, mentionedFiles);
      const attachedPaths = new Set(
        sharedDiffContexts.map((context) => normalizeDiffPath(context.filePath))
      );
      mentionedContexts = mentionResult.contexts.filter(
        (context) => !attachedPaths.has(normalizeDiffPath(context.filePath))
      );
      const warnings: string[] = [];
      if (mentionResult.unresolvedMentions.length > 0) {
        warnings.push(`missing: @${mentionResult.unresolvedMentions.join(", @")}`);
      }
      if (mentionResult.ambiguousMentions.length > 0) {
        warnings.push(`ambiguous: @${mentionResult.ambiguousMentions.join(", @")}`);
      }
      if (mentionResult.omittedPaths.length > 0) {
        warnings.push(
          `attached first ${MAX_MENTIONED_FILES} files only (extra: ${mentionResult.omittedPaths.join(", ")})`
        );
      }
      mentionWarningText = warnings.length > 0 ? ` Mention notes: ${warnings.join(" | ")}` : "";
    }

    const mentionedDiffSections = mentionedContexts
      .map(
        (context) =>
          `\n\n[Mentioned file diff]\npath=${context.filePath}\ntruncated=${context.truncated ? "yes" : "no"}\n${context.diff}`
      )
      .join("");
    const attachedDiffSections = sharedDiffContexts
      .map((context) => {
        const lineLabelSection = context.lineLabel ? `\nline=${context.lineLabel}` : "";
        const rangeSection =
          context.lineStart != null && context.lineEnd != null
            ? `\nrange=${context.lineStart}-${context.lineEnd}`
          : "";
        const noteSection = context.note ? `\nnote=${context.note}` : "";
        return `\n\n[Attached section diff]\npath=${context.filePath}${lineLabelSection}${rangeSection}${noteSection}\ntruncated=${context.truncated ? "yes" : "no"}\n${context.diff}`;
      })
      .join("");
    const scopedQuestion = `${question}${mentionedDiffSections}${attachedDiffSections}\n\n[Review context]\n${getReviewScopeContext(review.activeReviewScope())}`;

    setFollowUpBusy(true);
    ai.setAiStatus(`Sending follow-up question...${mentionWarningText}`);
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
    handlePrepareAiFollowUpForFile,
    handleAskAiFollowUp,
  };
}
