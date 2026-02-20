import type { ListWorkspaceBranchesResult } from "@/lib/backend";

export const DEFAULT_BASE_REF_TARGETS = [
  "origin/main",
  "origin/master",
  "main",
  "master",
  "HEAD~1",
];

export type ReviewBranchSuggestions = {
  currentBranch: string | null;
  branchTargets: string[];
  baseRefTargets: string[];
  suggestedBaseRef: string;
};

export function dedupeRefTargets(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(value);
  }
  return targets;
}

export function buildFallbackReviewBranchSuggestions(
  fallbackBaseRef: string,
  fallbackReviewBranch: string
): ReviewBranchSuggestions {
  const branchTargets = dedupeRefTargets([fallbackReviewBranch]);
  const baseRefTargets = dedupeRefTargets([fallbackBaseRef, ...DEFAULT_BASE_REF_TARGETS]);
  return {
    currentBranch: null,
    branchTargets,
    baseRefTargets,
    suggestedBaseRef: baseRefTargets[0] ?? "origin/main",
  };
}

export function buildReviewBranchSuggestionsFromWorkspaceBranches(
  result: ListWorkspaceBranchesResult,
  fallbackBaseRef: string,
  fallbackReviewBranch: string
): ReviewBranchSuggestions {
  const currentBranch = result.currentBranch?.trim() || null;
  const remoteTargets = result.remoteBranches.map((branch) => branch.name);
  const localTargets = result.branches.map((branch) => branch.name);
  const branchTargets = dedupeRefTargets([currentBranch, fallbackReviewBranch, ...localTargets]);
  const baseRefTargets = dedupeRefTargets([
    result.suggestedBaseRef,
    result.upstreamBranch,
    fallbackBaseRef,
    ...DEFAULT_BASE_REF_TARGETS,
    ...remoteTargets,
    ...localTargets,
  ]);
  return {
    currentBranch,
    branchTargets,
    baseRefTargets,
    suggestedBaseRef: result.suggestedBaseRef?.trim() || baseRefTargets[0] || "origin/main",
  };
}
