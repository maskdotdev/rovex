import type { Accessor, Setter } from "solid-js";
import type { AppView, RepoReviewDefaults, SettingsTab } from "@/app/types";
import type { ProviderKind } from "@/lib/backend";

export type UseProviderAndSettingsActionsArgs = {
  providerState: {
    selectedProvider: Accessor<ProviderKind>;
    setSelectedProvider: Setter<ProviderKind>;
    providerToken: Accessor<string>;
    setProviderToken: Setter<string>;
    repositoryInput: Accessor<string>;
    setRepositoryInput: Setter<string>;
    destinationRoot: Accessor<string>;
    setDestinationRoot: Setter<string>;
    localProjectPath: Accessor<string>;
    setLocalProjectPath: Setter<string>;
    providerBusy: Accessor<boolean>;
    setProviderBusy: Setter<boolean>;
    providerError: Accessor<string | null>;
    setProviderError: Setter<string | null>;
    providerStatus: Accessor<string | null>;
    setProviderStatus: Setter<string | null>;
    deviceAuthInProgress: Accessor<boolean>;
    setDeviceAuthInProgress: Setter<boolean>;
    deviceAuthUserCode: Accessor<string | null>;
    setDeviceAuthUserCode: Setter<string | null>;
    deviceAuthVerificationUrl: Accessor<string | null>;
    setDeviceAuthVerificationUrl: Setter<string | null>;
  };
  navigation: {
    setActiveView: Setter<AppView>;
    setActiveSettingsTab: Setter<SettingsTab>;
  };
  connectionRefetch: {
    refetchGithubConnection: () => unknown;
    refetchGitlabConnection: () => unknown;
  };
  repoState: {
    refetchThreads: () => unknown;
    setSelectedThreadId: Setter<number | null>;
    selectedBaseRef: Accessor<string>;
    setSelectedBaseRef: Setter<string>;
    reviewDefaultsByRepo: Accessor<Record<string, RepoReviewDefaults>>;
    setReviewDefaultsByRepo: Setter<Record<string, RepoReviewDefaults>>;
    knownRepoWorkspaces: Accessor<Record<string, string>>;
    setKnownRepoWorkspaces: Setter<Record<string, string>>;
    repoDisplayNames: Accessor<Record<string, string>>;
    setRepoDisplayNames: Setter<Record<string, string>>;
    collapsedRepos: Accessor<Record<string, boolean>>;
    setCollapsedRepos: Setter<Record<string, boolean>>;
    repoMenuOpen: Accessor<Record<string, boolean>>;
    setRepoMenuOpen: Setter<Record<string, boolean>>;
  };
  settingsState: {
    setSettingsError: Setter<string | null>;
  };
  aiSettingsState: {
    aiReviewProviderInput: Accessor<string>;
    aiReviewModelInput: Accessor<string>;
    aiOpencodeProviderInput: Accessor<string>;
    aiOpencodeModelInput: Accessor<string>;
    aiSettingsBusy: Accessor<boolean>;
    setAiSettingsBusy: Setter<boolean>;
    setAiSettingsError: Setter<string | null>;
    setAiSettingsStatus: Setter<string | null>;
    refetchAiReviewConfig: () => unknown;
  };
  accountState: {
    appServerAuthBusy: Accessor<boolean>;
    setAppServerAuthBusy: Setter<boolean>;
    setAppServerAuthError: Setter<string | null>;
    setAppServerAuthStatus: Setter<string | null>;
    refetchAppServerAccountStatus: () => unknown;
    refetchOpencodeSidecarStatus: () => unknown;
  };
  apiKeyState: {
    aiApiKeyInput: Accessor<string>;
    setAiApiKeyInput: Setter<string>;
    aiApiKeyBusy: Accessor<boolean>;
    setAiApiKeyBusy: Setter<boolean>;
    setAiApiKeyError: Setter<string | null>;
    setAiApiKeyStatus: Setter<string | null>;
  };
};
