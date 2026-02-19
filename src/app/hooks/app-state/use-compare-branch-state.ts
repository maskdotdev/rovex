import { createMemo, createSignal } from "solid-js";
import type { CompareWorkspaceDiffResult } from "@/lib/backend";

export function useCompareBranchState() {
  const [compareBusy, setCompareBusy] = createSignal(false);
  const [compareError, setCompareError] = createSignal<string | null>(null);
  const [compareResult, setCompareResult] = createSignal<CompareWorkspaceDiffResult | null>(null);
  const [showDiffViewer, setShowDiffViewer] = createSignal(false);
  const [selectedBaseRef, setSelectedBaseRef] = createSignal("origin/main");
  const [branchPopoverOpen, setBranchPopoverOpen] = createSignal(false);
  const [branchSearchQuery, setBranchSearchQuery] = createSignal("");
  const [branchCreateMode, setBranchCreateMode] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal("");
  const [branchActionBusy, setBranchActionBusy] = createSignal(false);
  const [branchActionError, setBranchActionError] = createSignal<string | null>(null);

  const compareSummary = createMemo(() => {
    const result = compareResult();
    if (!result) return null;
    const bytesLabel = result.diffBytesTotal >= 1024 * 1024
      ? `${(result.diffBytesTotal / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(result.diffBytesTotal / 1024))} KB`;
    const truncatedSuffix = result.diffTruncated
      ? ` (truncated to ${Math.max(1, Math.round(result.diffBytesUsed / 1024))} KB)`
      : "";
    return `${result.filesChanged} files changed +${result.insertions} -${result.deletions} vs ${result.baseRef} • ${bytesLabel}${truncatedSuffix} • ${result.profile.totalMs}ms`;
  });

  const canCreateBranch = createMemo(
    () => !branchActionBusy() && newBranchName().trim().length > 0
  );

  let branchSearchInputRef: HTMLInputElement | undefined;
  let branchCreateInputRef: HTMLInputElement | undefined;

  const setBranchSearchInputRef = (element: HTMLInputElement | undefined) => {
    branchSearchInputRef = element;
  };
  const setBranchCreateInputRef = (element: HTMLInputElement | undefined) => {
    branchCreateInputRef = element;
  };
  const getBranchSearchInputRef = () => branchSearchInputRef;
  const getBranchCreateInputRef = () => branchCreateInputRef;

  return {
    compareBusy,
    setCompareBusy,
    compareError,
    setCompareError,
    compareResult,
    setCompareResult,
    showDiffViewer,
    setShowDiffViewer,
    selectedBaseRef,
    setSelectedBaseRef,
    branchPopoverOpen,
    setBranchPopoverOpen,
    branchSearchQuery,
    setBranchSearchQuery,
    branchCreateMode,
    setBranchCreateMode,
    newBranchName,
    setNewBranchName,
    branchActionBusy,
    setBranchActionBusy,
    branchActionError,
    setBranchActionError,
    compareSummary,
    canCreateBranch,
    setBranchSearchInputRef,
    setBranchCreateInputRef,
    getBranchSearchInputRef,
    getBranchCreateInputRef,
  };
}
