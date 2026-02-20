import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  AiReviewChunk,
  AiReviewFinding,
  AiReviewProgressEvent,
} from "@/lib/backend";
import type { ReviewRun } from "@/app/review-types";

export type WorkspaceReviewSidebarDerivedModel = {
  reviewRuns: Accessor<ReviewRun[]>;
  selectedRunId: Accessor<string | null>;
  setSelectedRunId: (value: string | null) => void;
  aiChunkReviews: Accessor<AiReviewChunk[]>;
  aiFindings: Accessor<AiReviewFinding[]>;
  aiProgressEvents: Accessor<AiReviewProgressEvent[]>;
  aiReviewBusy: Accessor<boolean>;
};

export function severityRank(severity: string) {
  switch ((severity || "").toLowerCase()) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

export function resolveSelectedRun(runs: ReviewRun[], selectedRunId: string | null) {
  if (runs.length === 0) return null;
  if (selectedRunId) {
    const selected = runs.find((run) => run.id === selectedRunId);
    if (selected) return selected;
  }
  return runs[0] ?? null;
}

export function sortFindingsBySeverity(findings: AiReviewFinding[]) {
  return [...findings].sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) return bySeverity;
    const byPath = left.filePath.localeCompare(right.filePath);
    if (byPath !== 0) return byPath;
    return left.lineNumber - right.lineNumber;
  });
}

export type IssueFileCard = {
  id: string;
  filePath: string;
  chunkIndex: number;
  status: "running" | "clean" | "issues" | "failed";
  summary: string;
  findings: AiReviewFinding[];
  errorMessage: string | null;
};

function buildIssueFileCards(
  progressEvents: AiReviewProgressEvent[],
  chunkReviews: AiReviewChunk[]
): IssueFileCard[] {
  const byId = new Map<string, IssueFileCard>();
  const ensure = (args: { id: string; filePath: string; chunkIndex: number }) => {
    const existing = byId.get(args.id);
    if (existing) return existing;
    const created: IssueFileCard = {
      id: args.id,
      filePath: args.filePath,
      chunkIndex: args.chunkIndex,
      status: "running",
      summary: "",
      findings: [],
      errorMessage: null,
    };
    byId.set(args.id, created);
    return created;
  };

  for (const event of progressEvents) {
    if (event.status === "chunk-start") {
      const id = event.chunkId ?? `${event.filePath ?? "unknown"}#${event.chunkIndex ?? 0}`;
      const filePath = event.filePath ?? "unknown";
      const chunkIndex = event.chunkIndex ?? 0;
      ensure({ id, filePath, chunkIndex });
      continue;
    }

    if (event.status === "chunk-complete" && event.chunk) {
      const chunk = event.chunk;
      const card = ensure({
        id: chunk.id,
        filePath: chunk.filePath,
        chunkIndex: chunk.chunkIndex,
      });
      card.summary = chunk.summary;
      card.findings = chunk.findings;
      card.status = chunk.findings.length > 0 ? "issues" : "clean";
      card.errorMessage = null;
      continue;
    }

    if (event.status === "chunk-failed") {
      const id = event.chunkId ?? `${event.filePath ?? "unknown"}#${event.chunkIndex ?? 0}`;
      const filePath = event.filePath ?? "unknown";
      const chunkIndex = event.chunkIndex ?? 0;
      const card = ensure({ id, filePath, chunkIndex });
      card.status = "failed";
      card.errorMessage = event.message || "Issue scan failed for this file.";
    }
  }

  for (const chunk of chunkReviews) {
    const card = ensure({
      id: chunk.id,
      filePath: chunk.filePath,
      chunkIndex: chunk.chunkIndex,
    });
    card.summary = chunk.summary;
    card.findings = chunk.findings;
    if (card.status !== "failed") {
      card.status = chunk.findings.length > 0 ? "issues" : "clean";
    }
  }

  return [...byId.values()].sort((left, right) => {
    const byPath = left.filePath.localeCompare(right.filePath);
    if (byPath !== 0) return byPath;
    return left.chunkIndex - right.chunkIndex;
  });
}

export function buildIssuesEmptyMessage(args: {
  chunkCount: number;
  runStatus: ReviewRun["status"] | null;
  aiReviewBusy: boolean;
}) {
  if (args.chunkCount === 0) {
    if (args.runStatus === "queued") {
      return "Review is queued and will start shortly.";
    }
    return "Run review to scan this diff for issues.";
  }
  if (args.runStatus === "running" || args.aiReviewBusy) {
    return "Scanning files for issues. New findings will stream here in real time.";
  }
  return "No issues found for this run.";
}

export function useWorkspaceReviewSidebarViewModel(model: WorkspaceReviewSidebarDerivedModel) {
  const selectedRun = createMemo<ReviewRun | null>(() =>
    resolveSelectedRun(model.reviewRuns(), model.selectedRunId())
  );
  const visibleChunkReviews = createMemo(() => selectedRun()?.chunks ?? model.aiChunkReviews());
  const visibleFindings = createMemo(() => selectedRun()?.findings ?? model.aiFindings());
  const visibleProgressEvents = createMemo(
    () => selectedRun()?.progressEvents ?? model.aiProgressEvents()
  );
  const sortedVisibleFindings = createMemo(() => sortFindingsBySeverity(visibleFindings()));
  const issueFileCards = createMemo(() =>
    buildIssueFileCards(visibleProgressEvents(), visibleChunkReviews())
  );
  const latestProgress = createMemo(() => {
    const events = visibleProgressEvents();
    return events.length > 0 ? events[events.length - 1] : null;
  });
  const progressRatio = createMemo(() => {
    const progress = latestProgress();
    if (!progress || progress.totalChunks <= 0) return 0;
    return Math.round((progress.completedChunks / progress.totalChunks) * 100);
  });
  const issuesEmptyMessage = createMemo(() =>
    buildIssuesEmptyMessage({
      chunkCount: visibleChunkReviews().length,
      runStatus: selectedRun()?.status ?? null,
      aiReviewBusy: model.aiReviewBusy(),
    })
  );

  createEffect(() => {
    const runs = model.reviewRuns();
    if (runs.length === 0) {
      if (model.selectedRunId() !== null) {
        model.setSelectedRunId(null);
      }
      return;
    }

    const selectedId = model.selectedRunId();
    if (!selectedId || !runs.some((run) => run.id === selectedId)) {
      model.setSelectedRunId(runs[0].id);
    }
  });

  return {
    selectedRun,
    visibleChunkReviews,
    visibleFindings,
    visibleProgressEvents,
    sortedVisibleFindings,
    issueFileCards,
    latestProgress,
    progressRatio,
    issuesEmptyMessage,
  };
}
