import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import {
  DIFF_THEME_STORAGE_KEY,
  REPO_DISPLAY_NAME_STORAGE_KEY,
} from "@/app/constants";
import type { DiffThemePreset, RepoGroup } from "@/app/types";
import type {
  AiReviewChunk,
  AiReviewConfig,
  AiReviewFinding,
  AiReviewProgressEvent,
  CompareWorkspaceDiffResult,
} from "@/lib/backend";
import { createFullReviewScope, type ReviewScope } from "@/app/review-scope";
import type { ReviewRun, ReviewWorkbenchTab } from "@/app/review-types";

type UseAppEffectsArgs = {
  selectedDiffTheme: Accessor<DiffThemePreset>;
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
  setAiFollowUpBusy?: Setter<boolean>;
  setAiReviewError: Setter<string | null>;
  setAiStatus: Setter<string | null>;
  setAiChunkReviews: Setter<AiReviewChunk[]>;
  setAiFindings: Setter<AiReviewFinding[]>;
  setAiProgressEvents: Setter<AiReviewProgressEvent[]>;
  branchPopoverOpen: Accessor<boolean>;
  selectedWorkspace: Accessor<string>;
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
  refetchThreadMessages: () => unknown;
  aiReviewBusy: Accessor<boolean>;
  setAiRunElapsedSeconds: Setter<number>;
  setActiveReviewScope: Setter<ReviewScope>;
  setReviewRuns: Setter<ReviewRun[]>;
  selectedRunId: Accessor<string | null>;
  setSelectedRunId: Setter<string | null>;
  setReviewWorkbenchTab: Setter<ReviewWorkbenchTab>;
};

export function useAppEffects(args: UseAppEffectsArgs) {
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DIFF_THEME_STORAGE_KEY, args.selectedDiffTheme().id);
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REPO_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(args.repoDisplayNames()));
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

    args.setSelectedThreadId(groups[0].reviews[0]?.id ?? null);
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
    args.setAiFollowUpBusy?.(false);
    args.setAiReviewError(null);
    args.setAiStatus(null);
    args.setAiChunkReviews([]);
    args.setAiFindings([]);
    args.setAiProgressEvents([]);
    args.setActiveReviewScope(createFullReviewScope());
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
      void args.refetchWorkspaceBranches();
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

      args.setAiProgressEvents((current) => {
        const next = [...current, payload];
        return next.length > 160 ? next.slice(next.length - 160) : next;
      });

      if (payload.status === "started") {
        args.setAiReviewBusy(true);
        args.setAiReviewError(null);
        args.setAiStatus(payload.message);
        args.setAiChunkReviews([]);
        args.setAiFindings([]);
      } else if (payload.status === "failed") {
        args.setAiReviewBusy(false);
        args.setAiReviewError(payload.message);
      } else {
        args.setAiStatus(payload.message);
      }

      const chunk = payload.chunk;
      if (chunk) {
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
      if (finding) {
        args.setAiFindings((current) => {
          if (current.some((candidate) => candidate.id === finding.id)) {
            return current;
          }
          return [...current, finding];
        });
      }

      if (payload.status === "completed") {
        args.setAiReviewBusy(false);
        void args.refetchThreadMessages();
      }

      args.setReviewRuns((current) => {
        if (current.length === 0) return current;

        const selectedId = args.selectedRunId();
        const runningIndex = current.findIndex((candidate) => candidate.status === "running");
        const selectedIndex = selectedId
          ? current.findIndex((candidate) => candidate.id === selectedId)
          : -1;
        const targetIndex = runningIndex >= 0 ? runningIndex : selectedIndex;

        if (targetIndex < 0) return current;

        const run = current[targetIndex];
        const nextRuns = [...current];
        let nextRun = {
          ...run,
          progressEvents: [...run.progressEvents, payload].slice(-160),
        };

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

        if (payload.status === "failed") {
          nextRun = {
            ...nextRun,
            status: "failed",
            endedAt: Date.now(),
            error: payload.message,
          };
        } else if (payload.status === "completed") {
          nextRun = {
            ...nextRun,
            status: "completed",
            endedAt: Date.now(),
          };
        }

        nextRuns[targetIndex] = nextRun;
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
