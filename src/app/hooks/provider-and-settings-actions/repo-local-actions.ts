import { open } from "@tauri-apps/plugin-dialog";
import { cloneRepository, createThread } from "@/lib/backend";
import { providerOption, repoNameFromWorkspace } from "@/app/helpers";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

type RepoLocalActionsArgs = Pick<
  UseProviderAndSettingsActionsArgs,
  "providerState" | "navigation" | "repoState"
> & {
  clearProviderNotice: () => void;
};

export function createRepoLocalActions(args: RepoLocalActionsArgs) {
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
      providerState.setProviderError(toErrorMessage(error));
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
      providerState.setProviderError(toErrorMessage(error));
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
      providerState.setProviderError(toErrorMessage(error));
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
      providerState.setProviderError(toErrorMessage(error));
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
  };
}
