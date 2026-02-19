import { createEffect, onCleanup } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  connectProvider,
  disconnectProvider,
  pollProviderDeviceAuth,
  startProviderDeviceAuth,
  type ProviderKind,
  type StartProviderDeviceAuthResult,
} from "@/lib/backend";
import { providerOption, sleep } from "@/app/helpers";
import type { SettingsTab } from "@/app/types";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

type ProviderConnectionActionsArgs = Pick<
  UseProviderAndSettingsActionsArgs,
  "providerState" | "navigation" | "connectionRefetch"
>;

export function createProviderConnectionActions(args: ProviderConnectionActionsArgs) {
  const { providerState, navigation, connectionRefetch } = args;
  let deviceAuthSession = 0;

  const clearProviderNotice = () => {
    providerState.setProviderError(null);
    providerState.setProviderStatus(null);
  };

  const refetchProviderConnection = async (provider: ProviderKind) => {
    if (provider === "github") {
      await connectionRefetch.refetchGithubConnection();
      return;
    }
    await connectionRefetch.refetchGitlabConnection();
  };

  const cancelDeviceAuthFlow = () => {
    deviceAuthSession += 1;
    providerState.setDeviceAuthInProgress(false);
    providerState.setDeviceAuthUserCode(null);
    providerState.setDeviceAuthVerificationUrl(null);
  };

  onCleanup(() => {
    cancelDeviceAuthFlow();
  });

  createEffect(() => {
    providerState.selectedProvider();
    clearProviderNotice();
    cancelDeviceAuthFlow();
    providerState.setProviderToken("");
    providerState.setRepositoryInput("");
  });

  const openDeviceVerificationUrl = async (providerLabel: string) => {
    const url = providerState.deviceAuthVerificationUrl();
    if (!url) return;

    try {
      await openUrl(url);
    } catch (error) {
      providerState.setProviderError(
        error instanceof Error
          ? error.message
          : `Failed to open ${providerLabel} verification URL.`
      );
    }
  };

  const pollProviderDeviceAuthFlow = async (
    sessionId: number,
    provider: ProviderKind,
    flow: StartProviderDeviceAuthResult
  ) => {
    const label = providerOption(provider).label;
    let intervalMs = Math.max(1, flow.interval) * 1000;
    const expiresAt = Date.now() + Math.max(1, flow.expiresIn) * 1000;

    while (sessionId === deviceAuthSession && Date.now() < expiresAt) {
      await sleep(intervalMs);
      if (sessionId !== deviceAuthSession) {
        return;
      }

      try {
        const result = await pollProviderDeviceAuth({
          provider,
          deviceCode: flow.deviceCode,
        });
        if (sessionId !== deviceAuthSession) {
          return;
        }

        if (result.status === "complete" && result.connection) {
          await refetchProviderConnection(provider);
          cancelDeviceAuthFlow();
          providerState.setProviderStatus(`Connected ${label} as ${result.connection.accountLogin}.`);
          return;
        }

        if (result.status === "slow_down") {
          intervalMs += 5000;
        }
      } catch (error) {
        if (sessionId !== deviceAuthSession) {
          return;
        }
        cancelDeviceAuthFlow();
        providerState.setProviderError(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (sessionId !== deviceAuthSession) {
      return;
    }
    cancelDeviceAuthFlow();
    providerState.setProviderError(`${label} sign-in timed out. Start again.`);
  };

  const handleStartDeviceAuth = async () => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    const sessionId = deviceAuthSession;

    providerState.setProviderBusy(true);
    try {
      const flow = await startProviderDeviceAuth({ provider });
      const verificationUrl = flow.verificationUriComplete ?? flow.verificationUri;

      providerState.setDeviceAuthInProgress(true);
      providerState.setDeviceAuthUserCode(flow.userCode);
      providerState.setDeviceAuthVerificationUrl(verificationUrl);
      providerState.setProviderStatus(`Enter code ${flow.userCode} in ${selected.label} to finish connecting.`);

      await openDeviceVerificationUrl(selected.label);
      void pollProviderDeviceAuthFlow(sessionId, provider, flow);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
      cancelDeviceAuthFlow();
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const openSettings = (tab: SettingsTab = "connections") => {
    navigation.setActiveSettingsTab(tab);
    navigation.setActiveView("settings");
  };

  const closeSettings = () => {
    navigation.setActiveView("workspace");
  };

  const handleConnectProvider = async (event: Event) => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    event.preventDefault();
    clearProviderNotice();
    cancelDeviceAuthFlow();

    const token = providerState.providerToken().trim();
    if (!token) {
      providerState.setProviderError(`Enter a ${selected.label} personal access token.`);
      return;
    }

    providerState.setProviderBusy(true);
    try {
      const connection = await connectProvider({ provider, accessToken: token });
      providerState.setProviderToken("");
      await refetchProviderConnection(provider);
      providerState.setProviderStatus(`Connected ${selected.label} as ${connection.accountLogin}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  const handleDisconnectProvider = async () => {
    const provider = providerState.selectedProvider();
    const selected = providerOption(provider);

    clearProviderNotice();
    cancelDeviceAuthFlow();
    providerState.setProviderBusy(true);
    try {
      await disconnectProvider(provider);
      await refetchProviderConnection(provider);
      providerState.setProviderStatus(`Disconnected ${selected.label}.`);
    } catch (error) {
      providerState.setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      providerState.setProviderBusy(false);
    }
  };

  return {
    clearProviderNotice,
    openSettings,
    closeSettings,
    openDeviceVerificationUrl,
    handleStartDeviceAuth,
    handleConnectProvider,
    handleDisconnectProvider,
  };
}
