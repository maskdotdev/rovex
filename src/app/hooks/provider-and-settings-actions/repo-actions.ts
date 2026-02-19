import { createRepoLocalActions } from "@/app/hooks/provider-and-settings-actions/repo-local-actions";
import { createRepoManagementActions } from "@/app/hooks/provider-and-settings-actions/repo-management-actions";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

type RepoActionsArgs = Pick<
  UseProviderAndSettingsActionsArgs,
  "providerState" | "navigation" | "repoState"
> & {
  clearProviderNotice: () => void;
};

export function createRepoActions(args: RepoActionsArgs) {
  const localActions = createRepoLocalActions(args);
  const managementActions = createRepoManagementActions(args);

  return {
    ...localActions,
    ...managementActions,
  };
}
