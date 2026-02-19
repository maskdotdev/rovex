import { createMemo } from "solid-js";
import { useAiState } from "@/app/hooks/app-state/use-ai-state";
import { useCompareBranchState } from "@/app/hooks/app-state/use-compare-branch-state";
import { useCoreState } from "@/app/hooks/app-state/use-core-state";
import { usePrimaryResources } from "@/app/hooks/app-state/use-primary-resources";
import { useProviderState } from "@/app/hooks/app-state/use-provider-state";
import { useRepoState } from "@/app/hooks/app-state/use-repo-state";
import { useReviewWorkbenchState } from "@/app/hooks/app-state/use-review-workbench-state";
import { useWorkspaceResources } from "@/app/hooks/app-state/use-workspace-resources";

function toErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

export function useAppState() {
  const resources = usePrimaryResources();
  const coreState = useCoreState({
    githubConnection: resources.githubConnection,
    gitlabConnection: resources.gitlabConnection,
  });
  const repoState = useRepoState({ threads: resources.threads });
  const providerState = useProviderState();
  const compareBranchState = useCompareBranchState();
  const aiState = useAiState();
  const reviewWorkbenchState = useReviewWorkbenchState();

  const selectedWorkspace = createMemo(() => repoState.selectedReview()?.workspace?.trim() ?? "");
  const workspaceResources = useWorkspaceResources({
    selectedWorkspace,
    selectedThreadId: repoState.selectedThreadId,
  });

  const currentWorkspaceBranch = createMemo(() => {
    const result = workspaceResources.workspaceBranches();
    if (!result) return "main";
    return result.currentBranch?.trim() || "HEAD";
  });
  const filteredWorkspaceBranches = createMemo(() => {
    const query = compareBranchState.branchSearchQuery().trim().toLowerCase();
    const branches = workspaceResources.workspaceBranches()?.branches ?? [];
    if (!query) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(query));
  });

  const loadError = createMemo(() => toErrorMessage(resources.threads.error));
  const providerConnectionError = createMemo(() => {
    const error = coreState.selectedProvider() === "github"
      ? resources.githubConnection.error
      : resources.gitlabConnection.error;
    return toErrorMessage(error);
  });
  const workspaceBranchLoadError = createMemo(() =>
    toErrorMessage(workspaceResources.workspaceBranches.error)
  );
  const threadMessagesLoadError = createMemo(() =>
    toErrorMessage(workspaceResources.threadMessages.error)
  );
  const aiReviewConfigLoadError = createMemo(() => toErrorMessage(resources.aiReviewConfig.error));
  const opencodeSidecarLoadError = createMemo(() =>
    toErrorMessage(resources.opencodeSidecarStatus.error)
  );
  const appServerAccountLoadError = createMemo(() =>
    toErrorMessage(resources.appServerAccountStatus.error)
  );

  return {
    ...resources,
    ...coreState,
    ...repoState,
    ...providerState,
    ...compareBranchState,
    ...aiState,
    ...reviewWorkbenchState,
    selectedWorkspace,
    ...workspaceResources,
    currentWorkspaceBranch,
    filteredWorkspaceBranches,
    loadError,
    providerConnectionError,
    workspaceBranchLoadError,
    threadMessagesLoadError,
    aiReviewConfigLoadError,
    opencodeSidecarLoadError,
    appServerAccountLoadError,
  };
}
