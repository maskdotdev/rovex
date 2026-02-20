import { describe, expect, it } from "vitest";
import type { AiReviewRun } from "@/lib/backend";
import type { ReviewRun } from "@/app/review-types";
import {
  deriveTerminalStatusFromProgressEvents,
  hasActiveReviewRuns,
  mapPersistedReviewRun,
  mergePersistedReviewRuns,
  resolveReviewRunStatusFromProgress,
} from "@/app/hooks/review-run-sync";

function makePersistedRun(args: {
  runId: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  review?: string | null;
}): AiReviewRun {
  return {
    runId: args.runId,
    threadId: 1,
    workspace: "/tmp/workspace",
    baseRef: "origin/main",
    mergeBase: "abc123",
    head: "def456",
    filesChanged: 1,
    insertions: 2,
    deletions: 1,
    prompt: null,
    scopeLabel: "Full diff",
    status: args.status,
    totalChunks: 1,
    completedChunks: 1,
    failedChunks: 0,
    findingCount: 0,
    model: "gpt-4.1-mini",
    review: args.review ?? null,
    diffCharsUsed: 10,
    diffCharsTotal: 10,
    diffTruncated: false,
    error: null,
    chunks: [],
    findings: [],
    progressEvents: [],
    createdAt: "2026-02-20T00:00:00.000Z",
    startedAt: args.startedAt ?? "2026-02-20T00:00:01.000Z",
    endedAt: args.endedAt ?? null,
    canceledAt: null,
  };
}

function makeLocalRun(args: {
  id: string;
  status: ReviewRun["status"];
  endedAt?: number | null;
  review?: string | null;
}): ReviewRun {
  return {
    id: args.id,
    status: args.status,
    scope: { kind: "full" },
    scopeLabel: "Full diff",
    startedAt: 10,
    endedAt: args.endedAt ?? null,
    model: "gpt-4.1-mini",
    review: args.review ?? null,
    diffTruncated: false,
    error: null,
    progressEvents: [],
    chunks: [],
    findings: [],
  };
}

describe("mapPersistedReviewRun", () => {
  it("normalizes unknown statuses to running", () => {
    const mapped = mapPersistedReviewRun(makePersistedRun({ runId: "r1", status: "started" }));
    expect(mapped.status).toBe("running");
  });

  it("derives completed status from finished chunk progress when terminal event is missing", () => {
    const persisted = makePersistedRun({ runId: "r1", status: "running" });
    persisted.progressEvents = [
      {
        runId: "r1",
        threadId: 1,
        status: "chunk-complete",
        message: "done",
        totalChunks: 2,
        completedChunks: 2,
        chunkId: null,
        filePath: null,
        chunkIndex: null,
        findingCount: null,
        chunk: null,
        finding: null,
      },
    ];
    const mapped = mapPersistedReviewRun(persisted);
    expect(mapped.status).toBe("completed");
    expect(mapped.endedAt).not.toBeNull();
  });
});

describe("mergePersistedReviewRuns", () => {
  it("keeps local terminal status when persisted data regresses to running", () => {
    const currentRuns = [makeLocalRun({ id: "r1", status: "completed", endedAt: 200, review: "done" })];
    const persistedRuns = [
      makePersistedRun({
        runId: "r1",
        status: "running",
        endedAt: null,
        review: null,
      }),
    ];

    const merged = mergePersistedReviewRuns(currentRuns, persistedRuns);
    expect(merged[0]?.status).toBe("completed");
    expect(merged[0]?.endedAt).toBe(200);
    expect(hasActiveReviewRuns(merged)).toBe(false);
  });

  it("accepts terminal persisted status when local run is still active", () => {
    const currentRuns = [makeLocalRun({ id: "r1", status: "running" })];
    const persistedRuns = [
      makePersistedRun({
        runId: "r1",
        status: "completed_with_errors",
        endedAt: "2026-02-20T00:01:00.000Z",
      }),
    ];

    const merged = mergePersistedReviewRuns(currentRuns, persistedRuns);
    expect(merged[0]?.status).toBe("completed_with_errors");
    expect(hasActiveReviewRuns(merged)).toBe(false);
  });

  it("retains optimistic local runs until persisted run ids appear", () => {
    const currentRuns = [makeLocalRun({ id: "run-pending-123", status: "queued" })];
    const merged = mergePersistedReviewRuns(currentRuns, []);
    expect(merged.map((run) => run.id)).toEqual(["run-pending-123"]);
    expect(hasActiveReviewRuns(merged)).toBe(true);
  });
});

describe("progress-based status resolution", () => {
  it("returns completed_with_errors when failed chunk events exist", () => {
    const status = deriveTerminalStatusFromProgressEvents([
      {
        runId: "r1",
        threadId: 1,
        status: "chunk-failed",
        message: "failed",
        totalChunks: 2,
        completedChunks: 2,
        chunkId: null,
        filePath: null,
        chunkIndex: null,
        findingCount: null,
        chunk: null,
        finding: null,
      },
    ]);
    expect(status).toBe("completed_with_errors");
  });

  it("keeps active status while chunk progress is incomplete", () => {
    const status = resolveReviewRunStatusFromProgress("running", [
      {
        runId: "r1",
        threadId: 1,
        status: "chunk-complete",
        message: "partial",
        totalChunks: 3,
        completedChunks: 1,
        chunkId: null,
        filePath: null,
        chunkIndex: null,
        findingCount: null,
        chunk: null,
        finding: null,
      },
    ]);
    expect(status).toBe("running");
  });
});
