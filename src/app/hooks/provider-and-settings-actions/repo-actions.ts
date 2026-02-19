import { open } from "@tauri-apps/plugin-dialog";
import {
  checkoutWorkspaceBranch,
  cloneRepository,
  createThread,
  deleteThread,
} from "@/lib/backend";
import { providerOption, repoNameFromWorkspace } from "@/app/helpers";
import type { RepoGroup, RepoReview, RepoReviewDefaults } from "@/app/types";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

type RepoActionsArgs = Pick<
  UseProviderAndSettingsActionsArgs,
  "providerState" | "navigation" | "repoState"
> & {
  clearProviderNotice: () => void;
};

export function createRepoActions(args: RepoActionsArgs) {
  const { providerState, navigation, repoState, clearProviderNotice } = args;

  const handleCloneRepository = async (event: Event) => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();

    const repository = providerState.repositoryInput().trim();
    if (!repository) {
      providerState.setProviderError(`Enter a ${selected.label} repository path or URL.`);
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const cloneResult = await cloneRepository({
        provider,
        repository,
        destinationRoot: providerState.destinationRoot().trim() || null,
        shallow: true,
      });

      await createThread({
        title: `Review ${cloneResult.repository}`,
        workspace: cloneResult.workspace,
      });
      await repoState.refetchThreads();

      providerState.setRepositoryInput("");
      providerState.setProviderStatus(
        `Cloned ${cloneResult.repository} to ${cloneResult.workspace} and created a review thread.`
      );
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const pickDirectory = async (defaultPath?: string): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultPath?.trim() || undefined,
      });
      return typeof selected === "string" ? selected : null;
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const handlePickDestinationRoot = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(providerState.destinationRoot());
    if (!selectedPath) return;
    providerState.setDestinationRoot(selectedPath);
  };

  const handlePickLocalProject = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory(providerState.localProjectPath());
    if (!selectedPath) return;
    providerState.setLocalProjectPath(selectedPath);
  };

  const handleCreateLocalProjectThread = async (event: Event) => {
    event.preventDefault();
    clearProviderNotice();

    const workspace = providerState.localProjectPath().trim();
    if (!workspace) {
      providerState.setProviderError("Select a local project directory.");
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(workspace)}`,
        workspace,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      providerState.setLocalProjectPath("");
      providerState.setProviderStatus(`Added local project ${workspace} and created a review thread.`);
      navigation.setActiveView("workspace");
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleAddLocalRepoFromSidebar = async () => {
    clearProviderNotice();
    const selectedPath = await pickDirectory();
    if (!selectedPath) return;

    providerState.setProviderBusy(true);
    try {
      const thread = await createThread({
        title: `Review ${repoNameFromWorkspace(selectedPath)}`,
        workspace: selectedPath,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      providerState.setProviderStatus(`Added local project ${selectedPath} and created a review thread.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const isRepoCollapsed = (repoName: string) => repoState.collapsedRepos()[repoName] ?? false;
  const repoDisplayName = (repoName: string) => repoState.repoDisplayNames()[repoName] ?? repoName;
  const isRepoMenuOpen = (repoName: string) => repoState.repoMenuOpen()[repoName] ?? false;

  const toggleRepoCollapsed = (repoName: string) => {
    repoState.setCollapsedRepos((current) => ({
      ...current,
      [repoName]: !(current[repoName] ?? false),
    }));
  };

  const setRepoMenuOpenState = (repoName: string, open: boolean) => {
    repoState.setRepoMenuOpen((current) => ({
      ...current,
      [repoName]: open,
    }));
  };

  const makeReviewTitle = (repoName: string, goal: string) => {
    const displayName = repoDisplayName(repoName);
    const normalizedGoal = goal.trim();
    if (!normalizedGoal) {
      return `Review ${displayName}`;
    }
    const truncated =
      normalizedGoal.length > 72 ? `${normalizedGoal.slice(0, 69).trimEnd()}...` : normalizedGoal;
    return `Review ${displayName} - ${truncated}`;
  };

  const normalizeReviewGoal = (goal: string | null | undefined, repoName: string) => {
    const normalized = goal?.trim();
    if (normalized) return normalized;
    return `Review recent changes in ${repoDisplayName(repoName)}.`;
  };

  const normalizeBaseRef = (baseRef: string | null | undefined) => {
    const normalized = baseRef?.trim();
    if (normalized) return normalized;
    const selected = repoState.selectedBaseRef().trim();
    if (selected) return selected;
    return "origin/main";
  };

  const normalizeReviewBranch = (reviewBranch: string | null | undefined) => {
    const normalized = reviewBranch?.trim();
    if (normalized) return normalized;
    return "";
  };

  const handleCreateReviewForRepo = async (
    repo: RepoGroup,
    draft?: Partial<RepoReviewDefaults>
  ): Promise<boolean> => {
    clearProviderNotice();
    const workspace =
      repo.reviews.find((review) => review.workspace?.trim())?.workspace?.trim() ??
      repo.workspace?.trim() ??
      repoState.knownRepoWorkspaces()[repo.repoName]?.trim();
    if (!workspace) {
      providerState.setProviderError(`No local workspace found for ${repo.repoName}.`);
      return false;
    }

    const savedDefaults = repoState.reviewDefaultsByRepo()[repo.repoName];
    const goal = normalizeReviewGoal(draft?.goal ?? savedDefaults?.goal, repo.repoName);
    const baseRef = normalizeBaseRef(draft?.baseRef ?? savedDefaults?.baseRef);
    const reviewBranch = normalizeReviewBranch(draft?.reviewBranch ?? savedDefaults?.reviewBranch);

    providerState.setProviderBusy(true);
    try {
      if (reviewBranch) {
        await checkoutWorkspaceBranch({
          workspace,
          branchName: reviewBranch,
        });
      }
      const thread = await createThread({
        title: makeReviewTitle(repo.repoName, goal),
        workspace,
      });
      await repoState.refetchThreads();
      repoState.setSelectedThreadId(thread.id);
      repoState.setSelectedBaseRef(baseRef);
      repoState.setReviewDefaultsByRepo((current) => ({
        ...current,
        [repo.repoName]: reviewBranch ? { goal, baseRef, reviewBranch } : { goal, baseRef },
      }));
      repoState.setCollapsedRepos((current) => ({ ...current, [repo.repoName]: false }));
      providerState.setProviderStatus(
        `Created a new review for ${repoDisplayName(repo.repoName)} on ${reviewBranch || "current branch"} (vs ${baseRef}).`
      );
      setRepoMenuOpenState(repo.repoName, false);
      return true;
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleRenameRepo = (repo: RepoGroup) => {
    const existingName = repoDisplayName(repo.repoName);
    const nextName = window.prompt("Edit repository name", existingName)?.trim();
    if (!nextName) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    repoState.setRepoDisplayNames((current) => {
      const next = { ...current };
      next[repo.repoName] = nextName;
      return next;
    });
    providerState.setProviderStatus(`Renamed ${repo.repoName} to ${nextName}.`);
    setRepoMenuOpenState(repo.repoName, false);
  };

  const handleRemoveRepo = async (repo: RepoGroup) => {
    const displayName = repoDisplayName(repo.repoName);
    const reviewCount = repo.reviews.length;
    const confirmed = window.confirm(
      `Remove ${displayName} and ${reviewCount} review${reviewCount === 1 ? "" : "s"} from Rovex? Local files are not deleted.`
    );
    if (!confirmed) {
      setRepoMenuOpenState(repo.repoName, false);
      return;
    }

    clearProviderNotice();
    providerState.setProviderBusy(true);
    try {
      for (const review of repo.reviews) {
        await deleteThread(review.id);
      }
      await repoState.refetchThreads();
      repoState.setRepoDisplayNames((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      repoState.setCollapsedRepos((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      repoState.setKnownRepoWorkspaces((current) => {
        const next = { ...current };
        delete next[repo.repoName];
        return next;
      });
      providerState.setProviderStatus(
        `Removed ${displayName} with ${reviewCount} review${reviewCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
      setRepoMenuOpenState(repo.repoName, false);
    }
  };

  const handleRemoveReview = async (repo: RepoGroup, review: RepoReview) => {
    const displayName = repoDisplayName(repo.repoName);
    const reviewTitle = review.title?.trim() || "Untitled review";
    const workspace = review.workspace?.trim() || repo.workspace?.trim() || null;
    const confirmed = window.confirm(
      `Remove review "${reviewTitle}" from ${displayName}? Local files are not deleted.`
    );
    if (!confirmed) {
      return;
    }

    clearProviderNotice();
    providerState.setProviderBusy(true);
    try {
      if (workspace) {
        repoState.setKnownRepoWorkspaces((current) =>
          current[repo.repoName] === workspace
            ? current
            : {
                ...current,
                [repo.repoName]: workspace,
              }
        );
      }
      await deleteThread(review.id);
      await repoState.refetchThreads();
      providerState.setProviderStatus(`Removed review "${reviewTitle}" from ${displayName}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  return {
    handleCloneRepository,
    handlePickDestinationRoot,
    handlePickLocalProject,
    handleCreateLocalProjectThread,
    handleAddLocalRepoFromSidebar,
    isRepoCollapsed,
    repoDisplayName,
    isRepoMenuOpen,
    toggleRepoCollapsed,
    setRepoMenuOpenState,
    handleCreateReviewForRepo,
    handleRenameRepo,
    handleRemoveRepo,
    handleRemoveReview,
  };
}
