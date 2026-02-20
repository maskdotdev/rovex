import { createMemo, createSignal } from "solid-js";
import {
  getDiffThemePreset,
  getInitialDiffThemeId,
  getInitialFileOpenWith,
  getInitialGhosttyOpenCommand,
  getInitialMaskAccountEmail,
  getInitialReviewSidebarCollapsed,
  providerOption,
} from "@/app/helpers";
import type { AppView, SettingsTab } from "@/app/types";
import type { ProviderKind } from "@/lib/backend";

export function useCoreState() {
  const [activeView, setActiveView] = createSignal<AppView>("workspace");
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTab>("connections");
  const [selectedDiffThemeId, setSelectedDiffThemeId] = createSignal(getInitialDiffThemeId());
  const [maskAccountEmail, setMaskAccountEmail] = createSignal(getInitialMaskAccountEmail());
  const [reviewSidebarCollapsed, setReviewSidebarCollapsed] = createSignal(
    getInitialReviewSidebarCollapsed()
  );
  const [fileOpenWith, setFileOpenWith] = createSignal(getInitialFileOpenWith());
  const [ghosttyOpenCommand, setGhosttyOpenCommand] = createSignal(getInitialGhosttyOpenCommand());
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderKind>("github");

  const selectedDiffTheme = createMemo(() => getDiffThemePreset(selectedDiffThemeId()));
  const selectedProviderOption = createMemo(() => providerOption(selectedProvider()));

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
    fileOpenWith,
    setFileOpenWith,
    ghosttyOpenCommand,
    setGhosttyOpenCommand,
    settingsError,
    setSettingsError,
    selectedProvider,
    setSelectedProvider,
    selectedDiffTheme,
    selectedProviderOption,
  };
}
