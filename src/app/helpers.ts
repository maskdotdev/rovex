import type { ProviderKind, Thread } from "@/lib/backend";
import {
  ACCOUNT_EMAIL_MASK_STORAGE_KEY,
  DEFAULT_DIFF_THEME_ID,
  DIFF_THEME_STORAGE_KEY,
  KNOWN_REPO_WORKSPACES_STORAGE_KEY,
  REPO_DISPLAY_NAME_STORAGE_KEY,
  REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY,
  UNKNOWN_REPO,
  diffThemePresets,
  providerOptions,
} from "@/app/constants";
import type { DiffThemePreset, ProviderOption, RepoGroup, RepoReview } from "@/app/types";

export function providerOption(provider: ProviderKind): ProviderOption {
  const option = providerOptions.find((candidate) => candidate.id === provider);
  return option ?? providerOptions[0];
}

export function getDiffThemePreset(themeId: string | null | undefined): DiffThemePreset {
  const normalized = themeId?.trim();
  if (!normalized) return diffThemePresets[0];

  const preset = diffThemePresets.find((candidate) => candidate.id === normalized);
  return preset ?? diffThemePresets[0];
}

export function getInitialDiffThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_DIFF_THEME_ID;
  const storedThemeId = window.localStorage.getItem(DIFF_THEME_STORAGE_KEY);
  return getDiffThemePreset(storedThemeId).id;
}

export function getInitialRepoDisplayNames(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(REPO_DISPLAY_NAME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        normalized[key] = value.trim();
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

export function getInitialKnownRepoWorkspaces(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(KNOWN_REPO_WORKSPACES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        normalized[key] = value.trim();
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

export function getInitialMaskAccountEmail(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(ACCOUNT_EMAIL_MASK_STORAGE_KEY);
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getInitialReviewSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function repoNameFromWorkspace(workspace: string | null): string {
  const value = workspace?.trim();
  if (!value) return UNKNOWN_REPO;

  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSegment = normalized.split("/").pop()?.trim();
  return lastSegment && lastSegment.length > 0 ? lastSegment : value;
}

export function formatRelativeAge(createdAt: string): string {
  const normalized = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  const timestamp = Number.isNaN(parsed.getTime()) ? new Date(normalized).getTime() : parsed.getTime();

  if (Number.isNaN(timestamp)) return "now";

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

export function groupThreadsByRepo(
  threads: Thread[],
  knownRepoWorkspaces: Record<string, string> = {}
): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();

  for (const thread of threads) {
    const repoName = repoNameFromWorkspace(thread.workspace);
    const workspace = thread.workspace?.trim() || knownRepoWorkspaces[repoName] || null;
    const nextReview: RepoReview = {
      id: thread.id,
      title: thread.title,
      repoName,
      age: formatRelativeAge(thread.createdAt),
      workspace: thread.workspace,
    };

    const current = groups.get(repoName);
    if (current) {
      groups.set(repoName, {
        repoName,
        reviews: [...current.reviews, nextReview],
        workspace: current.workspace ?? workspace,
      });
      continue;
    }

    groups.set(repoName, {
      repoName,
      reviews: [nextReview],
      workspace,
    });
  }

  for (const [repoName, workspace] of Object.entries(knownRepoWorkspaces)) {
    if (groups.has(repoName)) continue;
    const normalizedWorkspace = workspace.trim();
    if (!normalizedWorkspace) continue;

    groups.set(repoName, {
      repoName,
      reviews: [],
      workspace: normalizedWorkspace,
    });
  }

  return [...groups.values()];
}
