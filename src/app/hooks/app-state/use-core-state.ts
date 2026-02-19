import { createMemo, createSignal, type Accessor } from "solid-js";
import {
  getDiffThemePreset,
  getInitialDiffThemeId,
  getInitialMaskAccountEmail,
  getInitialReviewSidebarCollapsed,
  providerOption,
} from "@/app/helpers";
import type { AppView, SettingsTab } from "@/app/types";
import type { ProviderConnection, ProviderKind } from "@/lib/backend";

type UseCoreStateArgs = {
  githubConnection: Accessor<ProviderConnection | null | undefined>;
  gitlabConnection: Accessor<ProviderConnection | null | undefined>;
};

export function useCoreState(args: UseCoreStateArgs) {
  const [activeView, setActiveView] = createSignal<AppView>("workspace");
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTab>("connections");
  const [selectedDiffThemeId, setSelectedDiffThemeId] = createSignal(getInitialDiffThemeId());
  const [maskAccountEmail, setMaskAccountEmail] = createSignal(getInitialMaskAccountEmail());
  const [reviewSidebarCollapsed, setReviewSidebarCollapsed] = createSignal(
    getInitialReviewSidebarCollapsed()
  );
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderKind>("github");

  const selectedDiffTheme = createMemo(() => getDiffThemePreset(selectedDiffThemeId()));
  const selectedProviderOption = createMemo(() => providerOption(selectedProvider()));
  const selectedProviderConnection = createMemo(() =>
    selectedProvider() === "github" ? args.githubConnection() : args.gitlabConnection()
  );

  return {
    activeView,
    setActiveView,
    activeSettingsTab,
    setActiveSettingsTab,
    selectedDiffThemeId,
    setSelectedDiffThemeId,
    maskAccountEmail,
    setMaskAccountEmail,
    reviewSidebarCollapsed,
    setReviewSidebarCollapsed,
    settingsError,
    setSettingsError,
    selectedProvider,
    setSelectedProvider,
    selectedDiffTheme,
    selectedProviderOption,
    selectedProviderConnection,
  };
}
