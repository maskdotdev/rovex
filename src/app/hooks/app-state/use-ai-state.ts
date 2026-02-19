import { createMemo, createSignal } from "solid-js";
import type { DiffViewerAnnotation } from "@/components/diff-viewer";
import type { AiReviewChunk, AiReviewFinding, AiReviewProgressEvent } from "@/lib/backend";

export function useAiState() {
  const [aiPrompt, setAiPrompt] = createSignal("");
  const [aiReviewBusy, setAiReviewBusy] = createSignal(false);
  const [aiFollowUpBusy, setAiFollowUpBusy] = createSignal(false);
  const [aiReviewError, setAiReviewError] = createSignal<string | null>(null);
  const [aiStatus, setAiStatus] = createSignal<string | null>(null);
  const [aiRunElapsedSeconds, setAiRunElapsedSeconds] = createSignal(0);
  const [aiApiKeyInput, setAiApiKeyInput] = createSignal("");
  const [aiApiKeyBusy, setAiApiKeyBusy] = createSignal(false);
  const [aiApiKeyError, setAiApiKeyError] = createSignal<string | null>(null);
  const [aiApiKeyStatus, setAiApiKeyStatus] = createSignal<string | null>(null);
  const [aiReviewProviderInput, setAiReviewProviderInput] = createSignal("openai");
  const [aiReviewModelInput, setAiReviewModelInput] = createSignal("gpt-4.1-mini");
  const [aiOpencodeProviderInput, setAiOpencodeProviderInput] = createSignal("openai");
  const [aiOpencodeModelInput, setAiOpencodeModelInput] = createSignal("");
  const [aiSettingsBusy, setAiSettingsBusy] = createSignal(false);
  const [aiSettingsError, setAiSettingsError] = createSignal<string | null>(null);
  const [aiSettingsStatus, setAiSettingsStatus] = createSignal<string | null>(null);
  const [appServerAuthBusy, setAppServerAuthBusy] = createSignal(false);
  const [appServerAuthError, setAppServerAuthError] = createSignal<string | null>(null);
  const [appServerAuthStatus, setAppServerAuthStatus] = createSignal<string | null>(null);
  const [aiChunkReviews, setAiChunkReviews] = createSignal<AiReviewChunk[]>([]);
  const [aiFindings, setAiFindings] = createSignal<AiReviewFinding[]>([]);
  const [aiProgressEvents, setAiProgressEvents] = createSignal<AiReviewProgressEvent[]>([]);

  const diffAnnotations = createMemo<DiffViewerAnnotation[]>(() =>
    aiFindings().map((finding) => {
      const normalizedSide: DiffViewerAnnotation["side"] =
        finding.side === "deletions" ? "deletions" : "additions";
      return {
        id: finding.id,
        filePath: finding.filePath,
        side: normalizedSide,
        lineNumber: finding.lineNumber,
        title: finding.title,
        body: finding.body,
        severity: finding.severity,
        chunkId: finding.chunkId,
      };
    })
  );

  return {
    aiPrompt,
    setAiPrompt,
    aiReviewBusy,
    setAiReviewBusy,
    aiFollowUpBusy,
    setAiFollowUpBusy,
    aiReviewError,
    setAiReviewError,
    aiStatus,
    setAiStatus,
    aiRunElapsedSeconds,
    setAiRunElapsedSeconds,
    aiApiKeyInput,
    setAiApiKeyInput,
    aiApiKeyBusy,
    setAiApiKeyBusy,
    aiApiKeyError,
    setAiApiKeyError,
    aiApiKeyStatus,
    setAiApiKeyStatus,
    aiReviewProviderInput,
    setAiReviewProviderInput,
    aiReviewModelInput,
    setAiReviewModelInput,
    aiOpencodeProviderInput,
    setAiOpencodeProviderInput,
    aiOpencodeModelInput,
    setAiOpencodeModelInput,
    aiSettingsBusy,
    setAiSettingsBusy,
    aiSettingsError,
    setAiSettingsError,
    aiSettingsStatus,
    setAiSettingsStatus,
    appServerAuthBusy,
    setAppServerAuthBusy,
    appServerAuthError,
    setAppServerAuthError,
    appServerAuthStatus,
    setAppServerAuthStatus,
    aiChunkReviews,
    setAiChunkReviews,
    aiFindings,
    setAiFindings,
    aiProgressEvents,
    setAiProgressEvents,
    diffAnnotations,
  };
}
