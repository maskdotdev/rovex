import { describe, expect, it } from "vitest";
import type { AiReviewFinding } from "@/lib/backend";
import type { ReviewRun } from "@/app/review-types";
import {
  buildIssuesEmptyMessage,
  resolveSelectedRun,
  sortFindingsBySeverity,
} from "@/app/components/workspace-review-sidebar-view-model";

function makeRun(id: string, status: ReviewRun["status"]): ReviewRun {
  return {
    id,
    status,
    scope: { kind: "full" },
    scopeLabel: id,
    startedAt: 0,
    endedAt: null,
    model: null,
    review: null,
    diffTruncated: false,
    error: null,
    progressEvents: [],
    chunks: [],
    findings: [],
  };
}

describe("resolveSelectedRun", () => {
  it("returns the explicitly selected run when present", () => {
    const runs = [makeRun("a", "queued"), makeRun("b", "running")];
    expect(resolveSelectedRun(runs, "b")?.id).toBe("b");
  });

  it("falls back to the first run when selection is missing", () => {
    const runs = [makeRun("a", "queued"), makeRun("b", "running")];
    expect(resolveSelectedRun(runs, "missing")?.id).toBe("a");
  });
});

describe("sortFindingsBySeverity", () => {
  it("sorts by severity, then path, then line number", () => {
    const findings: AiReviewFinding[] = [
      {
        id: "3",
        filePath: "b.ts",
        chunkId: "x",
        chunkIndex: 0,
        hunkHeader: "@@",
        side: "additions",
        lineNumber: 4,
        title: "low",
        body: "body",
        severity: "low",
        confidence: null,
      },
      {
        id: "1",
        filePath: "a.ts",
        chunkId: "x",
        chunkIndex: 0,
        hunkHeader: "@@",
        side: "additions",
        lineNumber: 20,
        title: "high-2",
        body: "body",
        severity: "high",
        confidence: null,
      },
      {
        id: "2",
        filePath: "a.ts",
        chunkId: "x",
        chunkIndex: 0,
        hunkHeader: "@@",
        side: "additions",
        lineNumber: 3,
        title: "high-1",
        body: "body",
        severity: "high",
        confidence: null,
      },
    ];

    expect(sortFindingsBySeverity(findings).map((finding) => finding.id)).toEqual(["2", "1", "3"]);
  });
});

describe("buildIssuesEmptyMessage", () => {
  it("returns queued message when there are no chunks and run is queued", () => {
    expect(
      buildIssuesEmptyMessage({
        chunkCount: 0,
        runStatus: "queued",
        aiReviewBusy: false,
      })
    ).toContain("queued");
  });

  it("returns scanning message when run is still in progress", () => {
    expect(
      buildIssuesEmptyMessage({
        chunkCount: 2,
        runStatus: "running",
        aiReviewBusy: true,
      })
    ).toContain("Scanning files");
  });
});
