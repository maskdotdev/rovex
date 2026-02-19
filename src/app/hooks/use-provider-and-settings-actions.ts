import { createAiSettingsActions } from "@/app/hooks/provider-and-settings-actions/ai-settings-actions";
import { createProviderConnectionActions } from "@/app/hooks/provider-and-settings-actions/provider-connection-actions";
import { createRepoActions } from "@/app/hooks/provider-and-settings-actions/repo-actions";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

export type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

export function useProviderAndSettingsActions(args: UseProviderAndSettingsActionsArgs) {
  const providerActions = createProviderConnectionActions({
    providerState: args.providerState,
    navigation: args.navigation,
    connectionRefetch: args.connectionRefetch,
  });
  const repoActions = createRepoActions({
    providerState: args.providerState,
    navigation: args.navigation,
    repoState: args.repoState,
    clearProviderNotice: providerActions.clearProviderNotice,
  });
  const aiActions = createAiSettingsActions({
    settingsState: args.settingsState,
    aiSettingsState: args.aiSettingsState,
    accountState: args.accountState,
    apiKeyState: args.apiKeyState,
  });

  return {
    openSettings: providerActions.openSettings,
    closeSettings: providerActions.closeSettings,
    openDeviceVerificationUrl: providerActions.openDeviceVerificationUrl,
    handleStartDeviceAuth: providerActions.handleStartDeviceAuth,
    handleConnectProvider: providerActions.handleConnectProvider,
    handleDisconnectProvider: providerActions.handleDisconnectProvider,
    ...repoActions,
    ...aiActions,
  };
}
