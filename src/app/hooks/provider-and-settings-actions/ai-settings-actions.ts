import { createEffect } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  setAiReviewApiKey,
  setAiReviewSettings,
  startAppServerAccountLogin,
} from "@/lib/backend";
import { toErrorMessage } from "@/app/hooks/error-utils";
import type { UseProviderAndSettingsActionsArgs } from "@/app/hooks/provider-and-settings-action-types";

type AiSettingsActionsArgs = Pick<
  UseProviderAndSettingsActionsArgs,
  "settingsState" | "aiSettingsState" | "accountState" | "apiKeyState"
>;

export function createAiSettingsActions(args: AiSettingsActionsArgs) {
  const { settingsState, aiSettingsState, accountState, apiKeyState } = args;

  const handleOpenDiffsDocs = async () => {
    settingsState.setSettingsError(null);
    try {
      await openUrl("https://diffs.com/");
    } catch (error) {
      settingsState.setSettingsError(toErrorMessage(error));
    }
  };

  const clearAiApiKeyNotice = () => {
    apiKeyState.setAiApiKeyError(null);
    apiKeyState.setAiApiKeyStatus(null);
  };

  const clearAiSettingsNotice = () => {
    aiSettingsState.setAiSettingsError(null);
    aiSettingsState.setAiSettingsStatus(null);
  };

  const clearAppServerAuthNotice = () => {
    accountState.setAppServerAuthError(null);
    accountState.setAppServerAuthStatus(null);
  };

  createEffect(() => {
    const provider = aiSettingsState.aiReviewProviderInput().trim().toLowerCase();
    if (provider !== "app-server") {
      clearAppServerAuthNotice();
    }
  });

  const handleSaveAiSettings = async (event: Event) => {
    event.preventDefault();
    clearAiSettingsNotice();

    const provider = aiSettingsState.aiReviewProviderInput().trim().toLowerCase();
    const model = aiSettingsState.aiReviewModelInput().trim();
    const opencodeProvider = aiSettingsState.aiOpencodeProviderInput().trim();
    const opencodeModel = aiSettingsState.aiOpencodeModelInput().trim();

    if (provider !== "openai" && provider !== "opencode" && provider !== "app-server") {
      aiSettingsState.setAiSettingsError("Provider must be openai, opencode, or app-server.");
      return;
    }
    if (!model) {
      aiSettingsState.setAiSettingsError("Enter a review model.");
      return;
    }

    aiSettingsState.setAiSettingsBusy(true);
    try {
      await setAiReviewSettings({
        reviewProvider: provider,
        reviewModel: model,
        opencodeProvider: opencodeProvider || "openai",
        opencodeModel: opencodeModel || null,
        persistToEnv: true,
      });
      await aiSettingsState.refetchAiReviewConfig();
      if (provider === "opencode") {
        await accountState.refetchOpencodeSidecarStatus();
      } else if (provider === "app-server") {
        await accountState.refetchAppServerAccountStatus();
      }
      aiSettingsState.setAiSettingsStatus(
        provider === "opencode"
          ? "Saved AI review settings for bundled OpenCode provider."
          : "Saved AI review settings."
      );
    } catch (error) {
      aiSettingsState.setAiSettingsError(toErrorMessage(error));
    } finally {
      aiSettingsState.setAiSettingsBusy(false);
    }
  };

  const handleSwitchAppServerAccount = async () => {
    if (accountState.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    accountState.setAppServerAuthBusy(true);
    try {
      const login = await startAppServerAccountLogin();
      await openUrl(login.authUrl);
      accountState.setAppServerAuthStatus(
        "Opened Codex sign-in in your browser. Finish login, then refresh account status."
      );
    } catch (error) {
      accountState.setAppServerAuthError(toErrorMessage(error));
    } finally {
      accountState.setAppServerAuthBusy(false);
    }
  };

  const handleRefreshAppServerAccountStatus = async () => {
    if (accountState.appServerAuthBusy()) return;
    clearAppServerAuthNotice();
    accountState.setAppServerAuthBusy(true);
    try {
      await accountState.refetchAppServerAccountStatus();
      accountState.setAppServerAuthStatus("Refreshed Codex account status.");
    } catch (error) {
      accountState.setAppServerAuthError(toErrorMessage(error));
    } finally {
      accountState.setAppServerAuthBusy(false);
    }
  };

  const handleSaveAiApiKey = async (event: Event) => {
    event.preventDefault();
    clearAiApiKeyNotice();

    const apiKey = apiKeyState.aiApiKeyInput().trim();
    if (!apiKey) {
      apiKeyState.setAiApiKeyError("Enter an API key.");
      return;
    }

    apiKeyState.setAiApiKeyBusy(true);
    try {
      const config = await setAiReviewApiKey({
        apiKey,
        persistToEnv: true,
      });
      apiKeyState.setAiApiKeyInput("");
      await aiSettingsState.refetchAiReviewConfig();
      apiKeyState.setAiApiKeyStatus(
        config.envFilePath
          ? `Saved OPENAI_API_KEY to ${config.envFilePath}.`
          : "Saved OPENAI_API_KEY."
      );
    } catch (error) {
      apiKeyState.setAiApiKeyError(toErrorMessage(error));
    } finally {
      apiKeyState.setAiApiKeyBusy(false);
    }
  };

  return {
    handleOpenDiffsDocs,
    handleSaveAiSettings,
    handleSwitchAppServerAccount,
    handleRefreshAppServerAccountStatus,
    handleSaveAiApiKey,
  };
}
