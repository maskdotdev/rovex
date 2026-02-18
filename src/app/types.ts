import type { Component } from "solid-js";
import type { DiffViewerTheme } from "@/components/diff-viewer";
import type { ProviderKind } from "@/lib/backend";

export type AppView = "workspace" | "settings";

export type SettingsTab =
  | "general"
  | "configuration"
  | "personalization"
  | "environments"
  | "archivedThreads"
  | "connections";

export type SettingsNavItem = {
  id: SettingsTab;
  label: string;
  description: string;
  icon: Component<{ class?: string }>;
};

export type RepoReview = {
  id: number;
  repoName: string;
  title: string;
  age: string;
  workspace: string | null;
};

export type RepoGroup = {
  repoName: string;
  reviews: RepoReview[];
};

export type DiffThemePreset = {
  id: string;
  label: string;
  description: string;
  theme: DiffViewerTheme;
};

export type ProviderOption = {
  id: ProviderKind;
  label: string;
  description: string;
  repositoryHint: string;
  tokenPlaceholder: string;
};
