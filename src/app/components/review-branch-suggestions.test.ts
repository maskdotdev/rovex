import { describe, expect, it } from "vitest";
import {
  buildFallbackReviewBranchSuggestions,
  buildReviewBranchSuggestionsFromWorkspaceBranches,
  dedupeRefTargets,
} from "@/app/components/review-branch-suggestions";

describe("dedupeRefTargets", () => {
  it("deduplicates case-insensitively while preserving first occurrence", () => {
    expect(dedupeRefTargets([" main ", "MAIN", "feature/a", "", null, "Feature/A"])).toEqual([
      "main",
      "feature/a",
    ]);
  });
});

describe("buildFallbackReviewBranchSuggestions", () => {
  it("builds defaults when no workspace data is available", () => {
    expect(buildFallbackReviewBranchSuggestions("origin/main", "feature/review")).toEqual({
      currentBranch: null,
      branchTargets: ["feature/review"],
      baseRefTargets: ["origin/main", "origin/master", "main", "master", "HEAD~1"],
      suggestedBaseRef: "origin/main",
    });
  });
});

describe("buildReviewBranchSuggestionsFromWorkspaceBranches", () => {
  it("prioritizes suggested/upstream refs and includes local+remote branches", () => {
    const suggestions = buildReviewBranchSuggestionsFromWorkspaceBranches(
      {
        workspace: "/tmp/repo",
        currentBranch: "feature/live",
        branches: [
          { name: "feature/live", isCurrent: true },
          { name: "feature/new", isCurrent: false },
        ],
        upstreamBranch: "origin/feature/live",
        remoteBranches: [
          { name: "origin/main", isCurrent: false },
          { name: "origin/feature/live", isCurrent: false },
        ],
        suggestedBaseRef: "origin/main",
      },
      "origin/main",
      "feature/manual"
    );

    expect(suggestions.currentBranch).toBe("feature/live");
    expect(suggestions.branchTargets).toEqual(["feature/live", "feature/manual", "feature/new"]);
    expect(suggestions.suggestedBaseRef).toBe("origin/main");
    expect(suggestions.baseRefTargets).toEqual([
      "origin/main",
      "origin/feature/live",
      "origin/master",
      "main",
      "master",
      "HEAD~1",
      "feature/live",
      "feature/new",
    ]);
  });
});
