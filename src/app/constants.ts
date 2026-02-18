import {
  Archive,
  CircleDot,
  Monitor,
  Palette,
  PlugZap,
  SlidersHorizontal,
} from "lucide-solid";
import type { DiffThemePreset, ProviderOption, SettingsNavItem } from "@/app/types";

export const settingsNavItems: SettingsNavItem[] = [
  {
    id: "general",
    label: "General",
    description: "Configure app-wide defaults and baseline behavior.",
    icon: CircleDot,
  },
  {
    id: "configuration",
    label: "Configuration",
    description: "Manage global settings applied to your entire Rovex workspace.",
    icon: SlidersHorizontal,
  },
  {
    id: "personalization",
    label: "Personalization",
    description: "Control how Rovex looks and feels for your workflow.",
    icon: Palette,
  },
  {
    id: "environments",
    label: "Environments",
    description: "Set environment-level options for local and remote contexts.",
    icon: Monitor,
  },
  {
    id: "archivedThreads",
    label: "Archived threads",
    description: "Review and restore archived review conversations.",
    icon: Archive,
  },
  {
    id: "connections",
    label: "Connections",
    description: "Connect providers used for cloning repositories and code review.",
    icon: PlugZap,
  },
];

export const UNKNOWN_REPO = "unknown-repo";
export const REPO_DISPLAY_NAME_STORAGE_KEY = "rovex.settings.repo-display-names";
export const DIFF_THEME_STORAGE_KEY = "rovex.settings.diff-theme";
export const DEFAULT_DIFF_THEME_ID = "rovex";

export const diffThemePresets: DiffThemePreset[] = [
  {
    id: "rovex",
    label: "Rovex",
    description: "Amber-forward palette matched to Rovex's glass and graphite UI.",
    theme: { dark: "rovex-dark", light: "rovex-light" },
  },
  {
    id: "pierre",
    label: "Pierre",
    description: "Default diffs.com theme pair used in Rovex.",
    theme: { dark: "pierre-dark", light: "pierre-light" },
  },
  {
    id: "github",
    label: "GitHub",
    description: "GitHub-style syntax colors and contrast.",
    theme: { dark: "github-dark", light: "github-light" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    description: "Softer palette with reduced glare in dark mode.",
    theme: { dark: "catppuccin-mocha", light: "catppuccin-latte" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    description: "Warm, muted contrast tuned for long reading sessions.",
    theme: { dark: "gruvbox-dark-medium", light: "gruvbox-light-medium" },
  },
  {
    id: "vitesse",
    label: "Vitesse",
    description: "High-legibility coding theme with vibrant accents.",
    theme: { dark: "vitesse-dark", light: "vitesse-light" },
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Classic low-contrast palette for balanced diff scanning.",
    theme: { dark: "solarized-dark", light: "solarized-light" },
  },
];

export const diffThemePreviewPatch = `diff --git a/src/components/status.ts b/src/components/status.ts
index 4c3f8d2..f3b58a1 100644
--- a/src/components/status.ts
+++ b/src/components/status.ts
@@ -1,7 +1,8 @@
 export function getStatusLabel(approved: boolean, pending: boolean) {
-  if (approved) return "Ready";
+  if (approved) return "Ready to ship";
   if (pending) return "Pending review";
+  const fallback = "Needs attention";

-  return "Blocked";
+  return fallback;
}
`;

export const providerOptions: ProviderOption[] = [
  {
    id: "github",
    label: "GitHub",
    description:
      "Connect GitHub with one-click device auth so Rovex can clone repositories for code review.",
    repositoryHint: "Supports owner/repo or a GitHub URL. Creates a review thread automatically.",
    tokenPlaceholder: "GitHub personal access token",
  },
  {
    id: "gitlab",
    label: "GitLab",
    description:
      "Connect GitLab to clone repositories for code review, including subgroup paths.",
    repositoryHint:
      "Supports namespace/repo (including subgroups) or a GitLab URL. Creates a review thread automatically.",
    tokenPlaceholder: "GitLab personal access token",
  },
];
