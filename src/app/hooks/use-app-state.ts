import { createMemo } from "solid-js";
import { toOptionalErrorMessage } from "@/app/hooks/error-utils";
import { useAiState } from "@/app/hooks/app-state/use-ai-state";
import { useCompareBranchState } from "@/app/hooks/app-state/use-compare-branch-state";
import { useCoreState } from "@/app/hooks/app-state/use-core-state";
import { usePrimaryResources } from "@/app/hooks/app-state/use-primary-resources";
import { useProviderState } from "@/app/hooks/app-state/use-provider-state";
import { useRepoState } from "@/app/hooks/app-state/use-repo-state";
import { useReviewWorkbenchState } from "@/app/hooks/app-state/use-review-workbench-state";
import { useWorkspaceResources } from "@/app/hooks/app-state/use-workspace-resources";

export function useAppState() {
  const coreState = useCoreState();
  const resources = usePrimaryResources({
    selectedProvider: coreState.selectedProvider,
  });
  const repoState = useRepoState({ threads: resources.threads });
  const providerState = useProviderState();
  const compareBranchState = useCompareBranchState();
  const aiState = useAiState();
  const reviewWorkbenchState = useReviewWorkbenchState();
  const selectedProviderConnection = createMemo(() =>
    coreState.selectedProvider() === "github"
      ? resources.githubConnection()
      : resources.gitlabConnection()
  );

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

  const loadError = createMemo(() => toOptionalErrorMessage(resources.threads.error));
  const providerConnectionError = createMemo(() => {
    const error = coreState.selectedProvider() === "github"
      ? resources.githubConnection.error
      : resources.gitlabConnection.error;
    return toOptionalErrorMessage(error);
  });
  const workspaceBranchLoadError = createMemo(() =>
    toOptionalErrorMessage(workspaceResources.workspaceBranches.error)
  );
  const threadMessagesLoadError = createMemo(() =>
    toOptionalErrorMessage(workspaceResources.threadMessages.error)
  );
  const aiReviewConfigLoadError = createMemo(() =>
    toOptionalErrorMessage(resources.aiReviewConfig.error)
  );
  const opencodeSidecarLoadError = createMemo(() =>
    toOptionalErrorMessage(resources.opencodeSidecarStatus.error)
  );
  const appServerAccountLoadError = createMemo(() =>
    toOptionalErrorMessage(resources.appServerAccountStatus.error)
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
    selectedProviderConnection,
    loadError,
    providerConnectionError,
    workspaceBranchLoadError,
    threadMessagesLoadError,
    aiReviewConfigLoadError,
    opencodeSidecarLoadError,
    appServerAccountLoadError,
  };
}
