import { createFullReviewScope } from "@/app/review-scope";
import type { ReviewRun } from "@/app/review-types";
import type { AiReviewRun as PersistedAiReviewRun } from "@/lib/backend";

export function isActiveReviewRunStatus(status: ReviewRun["status"]) {
  return status === "queued" || status === "running";
}

function isTerminalReviewRunStatus(status: ReviewRun["status"]) {
  return !isActiveReviewRunStatus(status);
}

function normalizeReviewRunStatus(status: string): ReviewRun["status"] {
  if (status === "queued" || status === "running") return status;
  if (status === "completed") return "completed";
  if (status === "completed_with_errors") return "completed_with_errors";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "running";
}

function parseTimestamp(raw: string | null | undefined) {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const terminalStatusByProgressEvent: Record<string, ReviewRun["status"]> = {
  completed: "completed",
  completed_with_errors: "completed_with_errors",
  failed: "failed",
  canceled: "canceled",
};

export function deriveTerminalStatusFromProgressEvents(
  progressEvents: ReviewRun["progressEvents"]
): ReviewRun["status"] | null {
  for (let index = progressEvents.length - 1; index >= 0; index -= 1) {
    const event = progressEvents[index];
    const mapped = terminalStatusByProgressEvent[event.status];
    if (mapped) return mapped;
  }

  const lastMeaningfulEvent = [...progressEvents]
    .reverse()
    .find((event) => event.status !== "description-delta");
  if (!lastMeaningfulEvent) return null;
  if (lastMeaningfulEvent.totalChunks <= 0) return null;
  if (lastMeaningfulEvent.completedChunks < lastMeaningfulEvent.totalChunks) return null;

  const hadErrors = progressEvents.some(
    (event) => event.status === "chunk-failed" || event.status === "description-failed"
  );
  return hadErrors ? "completed_with_errors" : "completed";
}

export function resolveReviewRunStatusFromProgress(
  status: string,
  progressEvents: ReviewRun["progressEvents"]
): ReviewRun["status"] {
  const normalized = normalizeReviewRunStatus(status);
  if (!isActiveReviewRunStatus(normalized)) {
    return normalized;
  }
  return deriveTerminalStatusFromProgressEvents(progressEvents) ?? normalized;
}

export function mapPersistedReviewRun(run: PersistedAiReviewRun): ReviewRun {
  const resolvedStatus = resolveReviewRunStatusFromProgress(run.status, run.progressEvents);
  const parsedEndedAt = parseTimestamp(run.endedAt);
  const shouldSetSyntheticEndedAt = isTerminalReviewRunStatus(resolvedStatus) && parsedEndedAt == null;
  return {
    id: run.runId,
    status: resolvedStatus,
    scope: createFullReviewScope(),
    scopeLabel: run.scopeLabel?.trim() || "AI review run",
    startedAt: parseTimestamp(run.startedAt) ?? parseTimestamp(run.createdAt) ?? Date.now(),
    endedAt: parsedEndedAt ?? (shouldSetSyntheticEndedAt ? Date.now() : null),
    model: run.model,
    review: run.review,
    diffTruncated: run.diffTruncated,
    error: run.error,
    progressEvents: run.progressEvents,
    chunks: run.chunks,
    findings: run.findings,
  };
}

function mergeRunForRaceRecovery(localRun: ReviewRun, persistedRun: ReviewRun): ReviewRun {
  const preferPersistedText = (persistedRun.review ?? "").trim().length > 0;
  const preferPersistedEvents = persistedRun.progressEvents.length >= localRun.progressEvents.length;
  const preferPersistedChunks = persistedRun.chunks.length >= localRun.chunks.length;
  const preferPersistedFindings = persistedRun.findings.length >= localRun.findings.length;

  return {
    ...persistedRun,
    status: localRun.status,
    endedAt: localRun.endedAt ?? persistedRun.endedAt,
    review: preferPersistedText ? persistedRun.review : localRun.review,
    error: persistedRun.error ?? localRun.error,
    progressEvents: preferPersistedEvents ? persistedRun.progressEvents : localRun.progressEvents,
    chunks: preferPersistedChunks ? persistedRun.chunks : localRun.chunks,
    findings: preferPersistedFindings ? persistedRun.findings : localRun.findings,
  };
}

export function mergePersistedReviewRuns(
  currentRuns: ReviewRun[],
  persistedRuns: PersistedAiReviewRun[]
): ReviewRun[] {
  const currentById = new Map(currentRuns.map((run) => [run.id, run]));
  const mergedPersistedRuns = persistedRuns.map((persistedRun) => {
    const mappedRun = mapPersistedReviewRun(persistedRun);
    const localRun = currentById.get(mappedRun.id);
    if (!localRun) return mappedRun;
    if (isTerminalReviewRunStatus(localRun.status) && isActiveReviewRunStatus(mappedRun.status)) {
      return mergeRunForRaceRecovery(localRun, mappedRun);
    }
    return mappedRun;
  });

  const mergedIds = new Set(mergedPersistedRuns.map((run) => run.id));
  const localRunsToKeep = currentRuns.filter(
    (run) =>
      !mergedIds.has(run.id) &&
      (isActiveReviewRunStatus(run.status) || run.id.startsWith("run-pending-"))
  );

  return [...localRunsToKeep, ...mergedPersistedRuns];
}

export function hasActiveReviewRuns(runs: ReviewRun[]) {
  return runs.some((run) => isActiveReviewRunStatus(run.status));
}
