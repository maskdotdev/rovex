import { createEffect, createResource, createSignal, type Accessor } from "solid-js";
import {
  listAiReviewRuns,
  listThreadMessages,
  listWorkspaceBranches,
  type AiReviewRun as PersistedAiReviewRun,
  type ListWorkspaceBranchesResult,
  type Message as ThreadMessage,
} from "@/lib/backend";

type UseWorkspaceResourcesArgs = {
  selectedWorkspace: Accessor<string>;
  selectedThreadId: Accessor<number | null>;
};

export function useWorkspaceResources(args: UseWorkspaceResourcesArgs) {
  const [workspaceBranchesLastFetchedAt, setWorkspaceBranchesLastFetchedAt] = createSignal(0);
  const [workspaceBranches, { refetch: rawRefetchWorkspaceBranches }] = createResource(
    args.selectedWorkspace,
    async (workspace): Promise<ListWorkspaceBranchesResult | null> => {
      const normalizedWorkspace = workspace.trim();
      if (!normalizedWorkspace) return null;
      return listWorkspaceBranches({ workspace: normalizedWorkspace });
    }
  );
  const [threadMessages, { refetch: refetchThreadMessages }] = createResource(
    args.selectedThreadId,
    async (threadId): Promise<ThreadMessage[]> => {
      if (threadId == null) return [];
      return listThreadMessages(threadId, 100);
    }
  );
  const [persistedReviewRuns, { refetch: refetchAiReviewRuns }] = createResource(
    args.selectedThreadId,
    async (threadId): Promise<PersistedAiReviewRun[]> => {
      if (threadId == null) return [];
      const response = await listAiReviewRuns({ threadId, limit: 50 });
      return response.runs;
    }
  );

  createEffect(() => {
    const workspace = args.selectedWorkspace().trim();
    if (!workspace) {
      setWorkspaceBranchesLastFetchedAt(0);
      return;
    }
    if (workspaceBranches()) {
      setWorkspaceBranchesLastFetchedAt(Date.now());
    }
  });

  const refetchWorkspaceBranches = async () => {
    const result = await rawRefetchWorkspaceBranches();
    if (result) {
      setWorkspaceBranchesLastFetchedAt(Date.now());
    }
    return result;
  };

  return {
    workspaceBranches,
    refetchWorkspaceBranches,
    workspaceBranchesLastFetchedAt,
    threadMessages,
    refetchThreadMessages,
    persistedReviewRuns,
    refetchAiReviewRuns,
  };
}
