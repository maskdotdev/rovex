import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import {
  ACCOUNT_EMAIL_MASK_STORAGE_KEY,
  DIFF_THEME_STORAGE_KEY,
  FILE_OPEN_WITH_STORAGE_KEY,
  GHOSTTY_OPEN_COMMAND_STORAGE_KEY,
  KNOWN_REPO_WORKSPACES_STORAGE_KEY,
  REPO_REVIEW_DEFAULTS_STORAGE_KEY,
  REPO_DISPLAY_NAME_STORAGE_KEY,
  REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "@/app/constants";
import type { DiffThemePreset, RepoGroup, RepoReviewDefaults } from "@/app/types";
import type {
  AiReviewChunk,
  AiReviewConfig,
  AiReviewFinding,
  AiReviewProgressEvent,
  AiReviewRun as PersistedAiReviewRun,
  CompareWorkspaceDiffResult,
} from "@/lib/backend";
import { createFullReviewScope, type ReviewScope } from "@/app/review-scope";
import {
  hasActiveReviewRuns,
  mergePersistedReviewRuns,
  resolveReviewRunStatusFromProgress,
} from "@/app/hooks/review-run-sync";
import type {
  ReviewDiffFocusTarget,
  ReviewChatSharedDiffContext,
  ReviewRun,
  ReviewWorkbenchTab,
} from "@/app/review-types";

type UseAppEffectsArgs = {
  selectedDiffTheme: Accessor<DiffThemePreset>;
  knownRepoWorkspaces: Accessor<Record<string, string>>;
  setKnownRepoWorkspaces: Setter<Record<string, string>>;
  repoDisplayNames: Accessor<Record<string, string>>;
  repoGroups: Accessor<RepoGroup[]>;
  selectedThreadId: Accessor<number | null>;
  setSelectedThreadId: Setter<number | null>;
  setCompareError: Setter<string | null>;
  setCompareResult: Setter<CompareWorkspaceDiffResult | null>;
  setShowDiffViewer: Setter<boolean>;
  setBranchPopoverOpen: Setter<boolean>;
  setBranchSearchQuery: Setter<string>;
  setBranchCreateMode: Setter<boolean>;
  setNewBranchName: Setter<string>;
  setBranchActionError: Setter<string | null>;
  setAiPrompt: Setter<string>;
  setAiSharedDiffContext: Setter<ReviewChatSharedDiffContext | null>;
  setAiFollowUpBusy?: Setter<boolean>;
  setAiReviewError: Setter<string | null>;
  setAiStatus: Setter<string | null>;
  setAiChunkReviews: Setter<AiReviewChunk[]>;
  setAiFindings: Setter<AiReviewFinding[]>;
  setAiProgressEvents: Setter<AiReviewProgressEvent[]>;
  branchPopoverOpen: Accessor<boolean>;
  selectedWorkspace: Accessor<string>;
  workspaceBranchesLastFetchedAt: Accessor<number>;
  refetchWorkspaceBranches: () => unknown;
  getBranchSearchInputRef: () => HTMLInputElement | undefined;
  branchCreateMode: Accessor<boolean>;
  getBranchCreateInputRef: () => HTMLInputElement | undefined;
  aiReviewConfig: Accessor<AiReviewConfig | undefined>;
  setAiReviewProviderInput: Setter<string>;
  setAiReviewModelInput: Setter<string>;
  setAiOpencodeProviderInput: Setter<string>;
  setAiOpencodeModelInput: Setter<string>;
  setAiReviewBusy: Setter<boolean>;
  persistedReviewRuns: Accessor<PersistedAiReviewRun[] | undefined>;
  refetchThreadMessages: () => unknown;
  refetchAiReviewRuns?: () => unknown;
  aiReviewBusy: Accessor<boolean>;
  setAiRunElapsedSeconds: Setter<number>;
  setActiveReviewScope: Setter<ReviewScope>;
  setDiffFocusTarget: Setter<ReviewDiffFocusTarget | null>;
  setReviewRuns: Setter<ReviewRun[]>;
  selectedRunId: Accessor<string | null>;
  setSelectedRunId: Setter<string | null>;
  setReviewWorkbenchTab: Setter<ReviewWorkbenchTab>;
  maskAccountEmail: Accessor<boolean>;
  reviewSidebarCollapsed: Accessor<boolean>;
  setReviewSidebarCollapsed: Setter<boolean>;
  fileOpenWith: Accessor<string>;
  ghosttyOpenCommand: Accessor<string>;
  reviewDefaultsByRepo: Accessor<Record<string, RepoReviewDefaults>>;
  handleCompareSelectedReview: () => void | Promise<void>;
};

const WORKSPACE_BRANCHES_STALE_MS = 30_000;

export function useAppEffects(args: UseAppEffectsArgs) {
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DIFF_THEME_STORAGE_KEY, args.selectedDiffTheme().id);
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      KNOWN_REPO_WORKSPACES_STORAGE_KEY,
      JSON.stringify(args.knownRepoWorkspaces())
    );
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REPO_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(args.repoDisplayNames()));
  });

  createEffect(() => {
    const groups = args.repoGroups();
    args.setKnownRepoWorkspaces((current) => {
      let changed = false;
      const next = { ...current };

      for (const group of groups) {
        const workspace = group.workspace?.trim();
        if (!workspace) continue;
        if (next[group.repoName] === workspace) continue;
        next[group.repoName] = workspace;
        changed = true;
      }

      return changed ? next : current;
    });
  });

  createEffect(() => {
    const groups = args.repoGroups();
    if (groups.length === 0) {
      args.setSelectedThreadId(null);
      return;
    }

    const selected = args.selectedThreadId();
    const hasSelected = groups.some((group) => group.reviews.some((review) => review.id === selected));
    if (hasSelected) return;

    const firstReview = groups.find((group) => group.reviews.length > 0)?.reviews[0];
    args.setSelectedThreadId(firstReview?.id ?? null);
  });

  createEffect(() => {
    const runs = args.persistedReviewRuns();
    if (!runs) return;
    let mergedRuns: ReviewRun[] = [];
    args.setReviewRuns((current) => {
      mergedRuns = mergePersistedReviewRuns(current, runs);
      return mergedRuns;
    });
    args.setAiReviewBusy(hasActiveReviewRuns(mergedRuns));
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACCOUNT_EMAIL_MASK_STORAGE_KEY, args.maskAccountEmail() ? "1" : "0");
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REVIEW_SIDEBAR_COLLAPSED_STORAGE_KEY,
      args.reviewSidebarCollapsed() ? "1" : "0"
    );
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FILE_OPEN_WITH_STORAGE_KEY, args.fileOpenWith());
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const normalized = args.ghosttyOpenCommand().trim();
    if (!normalized) {
      window.localStorage.removeItem(GHOSTTY_OPEN_COMMAND_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(GHOSTTY_OPEN_COMMAND_STORAGE_KEY, normalized);
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REPO_REVIEW_DEFAULTS_STORAGE_KEY,
      JSON.stringify(args.reviewDefaultsByRepo())
    );
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "b" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey
      ) {
        event.preventDefault();
        args.setReviewSidebarCollapsed((collapsed) => !collapsed);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  createEffect(() => {
    args.selectedThreadId();
    args.setCompareError(null);
    args.setCompareResult(null);
    args.setShowDiffViewer(false);
    args.setBranchPopoverOpen(false);
    args.setBranchSearchQuery("");
    args.setBranchCreateMode(false);
    args.setNewBranchName("");
    args.setBranchActionError(null);
    args.setAiPrompt("");
    args.setAiSharedDiffContext(null);
    args.setAiFollowUpBusy?.(false);
    args.setAiReviewError(null);
    args.setAiStatus(null);
    args.setAiChunkReviews([]);
    args.setAiFindings([]);
    args.setAiProgressEvents([]);
    args.setActiveReviewScope(createFullReviewScope());
    args.setDiffFocusTarget(null);
    args.setReviewRuns([]);
    args.setSelectedRunId(null);
    args.setReviewWorkbenchTab("description");
  });

  createEffect(() => {
    if (!args.branchPopoverOpen()) return;
    args.setBranchSearchQuery("");
    args.setBranchCreateMode(false);
    args.setNewBranchName("");
    args.setBranchActionError(null);
    if (args.selectedWorkspace().length > 0) {
      const elapsedMs = Date.now() - args.workspaceBranchesLastFetchedAt();
      const shouldRefresh =
        args.workspaceBranchesLastFetchedAt() <= 0 || elapsedMs > WORKSPACE_BRANCHES_STALE_MS;
      if (shouldRefresh) {
        void args.refetchWorkspaceBranches();
      }
    }
    queueMicrotask(() => {
      args.getBranchSearchInputRef()?.focus();
    });
  });

  createEffect(() => {
    if (!args.branchCreateMode()) return;
    queueMicrotask(() => {
      args.getBranchCreateInputRef()?.focus();
    });
  });

  createEffect(() => {
    const threadId = args.selectedThreadId();
    if (threadId == null) return;

    const workspace = args.selectedWorkspace().trim();
    if (!workspace) return;

    void args.handleCompareSelectedReview();
  });

  createEffect(() => {
    const config = args.aiReviewConfig();
    if (!config) return;
    args.setAiReviewProviderInput(config.reviewProvider || "openai");
    args.setAiReviewModelInput(config.reviewModel || "gpt-4.1-mini");
    args.setAiOpencodeProviderInput(config.opencodeProvider || "openai");
    args.setAiOpencodeModelInput(config.opencodeModel ?? "");
  });

  createEffect(() => {
    let active = true;
    let stopListening: (() => void) | null = null;

    void listen<AiReviewProgressEvent>("rovex://ai-review-progress", (event) => {
      if (!active) return;
      const payload = event.payload;
      const selected = args.selectedThreadId();
      if (selected != null && payload.threadId !== selected) return;
      const payloadRunId = payload.runId;
      const selectedRunId = args.selectedRunId();
      const runIsSelected =
        payloadRunId != null
          ? selectedRunId == null || selectedRunId === payloadRunId
          : true;
      const shouldTrackProgressEvent = payload.status !== "description-delta";

      if (runIsSelected && shouldTrackProgressEvent) {
        args.setAiProgressEvents((current) => {
          const next = [...current, payload];
          return next.length > 160 ? next.slice(next.length - 160) : next;
        });
        if (payload.status === "started") {
          args.setAiReviewError(null);
          args.setAiChunkReviews([]);
          args.setAiFindings([]);
        }
      }
      if (payload.status !== "description-delta") {
        args.setAiStatus(payload.message);
      }
      if (payload.status === "failed") {
        args.setAiReviewError(payload.message);
      }

      const chunk = payload.chunk;
      if (chunk && runIsSelected) {
        args.setAiChunkReviews((current) => {
          const next = [...current];
          const existingIndex = next.findIndex((candidate) => candidate.id === chunk.id);
          if (existingIndex >= 0) {
            next[existingIndex] = chunk;
          } else {
            next.push(chunk);
          }
          return next.sort((left, right) =>
            left.filePath.localeCompare(right.filePath) || left.chunkIndex - right.chunkIndex
          );
        });
      }

      const finding = payload.finding;
      if (finding && runIsSelected) {
        args.setAiFindings((current) => {
          if (current.some((candidate) => candidate.id === finding.id)) {
            return current;
          }
          return [...current, finding];
        });
      }

      args.setReviewRuns((current) => {
        const nextRuns = [...current];
        const effectiveRunId = payloadRunId ?? args.selectedRunId();
        if (!effectiveRunId) {
          return current;
        }
        let targetIndex = nextRuns.findIndex((candidate) => candidate.id === effectiveRunId);
        if (targetIndex < 0) {
          nextRuns.unshift({
            id: effectiveRunId,
            status: "queued",
            scope: createFullReviewScope(),
            scopeLabel: "AI review run",
            startedAt: Date.now(),
            endedAt: null,
            model: null,
            review: null,
            diffTruncated: false,
            error: null,
            progressEvents: [],
            chunks: [],
            findings: [],
          });
          targetIndex = 0;
        }

        const run = nextRuns[targetIndex];
        let nextRun = {
          ...run,
          progressEvents: shouldTrackProgressEvent
            ? [...run.progressEvents, payload].slice(-160)
            : run.progressEvents,
        };

        if (payload.status === "description-start") {
          nextRun = {
            ...nextRun,
            review: "",
          };
        } else if (payload.status === "description-delta") {
          nextRun = {
            ...nextRun,
            review: `${nextRun.review ?? ""}${payload.message}`,
          };
        }

        if (chunk) {
          const nextChunks = [...nextRun.chunks];
          const existingChunkIndex = nextChunks.findIndex((candidate) => candidate.id === chunk.id);
          if (existingChunkIndex >= 0) {
            nextChunks[existingChunkIndex] = chunk;
          } else {
            nextChunks.push(chunk);
          }
          nextRun = {
            ...nextRun,
            chunks: nextChunks.sort(
              (left, right) =>
                left.filePath.localeCompare(right.filePath) || left.chunkIndex - right.chunkIndex
            ),
          };
        }

        if (finding) {
          if (!nextRun.findings.some((candidate) => candidate.id === finding.id)) {
            nextRun = {
              ...nextRun,
              findings: [...nextRun.findings, finding],
            };
          }
        }

        if (payload.status === "queued") {
          nextRun = {
            ...nextRun,
            status: "queued",
          };
        } else if (payload.status === "started") {
          nextRun = {
            ...nextRun,
            status: "running",
            error: null,
          };
        } else if (payload.status === "failed") {
          nextRun = {
            ...nextRun,
            status: "failed",
            endedAt: Date.now(),
            error: payload.message,
          };
        } else if (payload.status === "canceled") {
          nextRun = {
            ...nextRun,
            status: "canceled",
            endedAt: Date.now(),
            error: payload.message,
          };
        } else if (payload.status === "completed_with_errors") {
          nextRun = {
            ...nextRun,
            status: "completed_with_errors",
            endedAt: Date.now(),
          };
        } else if (payload.status === "completed") {
          nextRun = {
            ...nextRun,
            status: "completed",
            endedAt: Date.now(),
          };
        } else if (payload.status === "description-failed") {
          nextRun = {
            ...nextRun,
            error: nextRun.error ?? payload.message,
          };
        }

        const resolvedStatus = resolveReviewRunStatusFromProgress(
          nextRun.status,
          nextRun.progressEvents
        );
        if (resolvedStatus !== nextRun.status) {
          nextRun = {
            ...nextRun,
            status: resolvedStatus,
            endedAt:
              nextRun.endedAt ??
              (resolvedStatus === "queued" || resolvedStatus === "running" ? null : Date.now()),
          };
        }

        nextRuns[targetIndex] = nextRun;
        const hasActiveRun = nextRuns.some(
          (candidate) => candidate.status === "queued" || candidate.status === "running"
        );
        args.setAiReviewBusy(hasActiveRun);
        if (
          payload.status === "completed" ||
          payload.status === "completed_with_errors" ||
          payload.status === "failed" ||
          payload.status === "canceled"
        ) {
          void args.refetchThreadMessages();
          void args.refetchAiReviewRuns?.();
        }
        if (runIsSelected && payloadRunId && args.selectedRunId() == null) {
          args.setSelectedRunId(payloadRunId);
        }
        return nextRuns;
      });
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      stopListening = unlisten;
    });

    onCleanup(() => {
      active = false;
      stopListening?.();
    });
  });

  createEffect(() => {
    if (!args.aiReviewBusy()) {
      args.setAiRunElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    args.setAiRunElapsedSeconds(0);
    void args.refetchThreadMessages();

    const interval = window.setInterval(() => {
      args.setAiRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      void args.refetchThreadMessages();
    }, 1200);

    onCleanup(() => {
      window.clearInterval(interval);
    });
  });
}
