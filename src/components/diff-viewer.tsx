import {
  FileDiff,
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  Columns2,
  Hash,
  PaintBucket,
  Rows3,
  Sparkles,
  WrapText,
} from "lucide-solid";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";
import { render as renderSolid } from "solid-js/web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip";

const rovexDarkThemeDefaults = {
  foreground: "#F2F4F8",
  background: "#0F1116",
  "ansi-black": "#17171A",
  "ansi-red": "#FF7B72",
  "ansi-green": "#3FD28E",
  "ansi-yellow": "#F6C766",
  "ansi-blue": "#79B8FF",
  "ansi-magenta": "#C9A7FF",
  "ansi-cyan": "#66D9E8",
  "ansi-white": "#E8E8EA",
  "ansi-bright-black": "#6F768A",
  "ansi-bright-red": "#FFB0A9",
  "ansi-bright-green": "#8CECC0",
  "ansi-bright-yellow": "#F8D995",
  "ansi-bright-blue": "#A8D2FF",
  "ansi-bright-magenta": "#E0CBFF",
  "ansi-bright-cyan": "#A5EDF5",
  "ansi-bright-white": "#F8F8FA",
  "token-link": "#F5C86E",
  "token-string": "#86E1A8",
  "token-comment": "#8D94A8",
  "token-constant": "#D5BCFF",
  "token-keyword": "#E7BE58",
  "token-parameter": "#F0D08F",
  "token-function": "#8AC7FF",
  "token-string-expression": "#F4D07F",
  "token-punctuation": "#BAC1D3",
  "token-inserted": "#6CE4A8",
  "token-deleted": "#FF9C94",
  "token-changed": "#F4D27C",
} as const;

const rovexLightThemeDefaults = {
  foreground: "#2B2A28",
  background: "#F7F4EC",
  "ansi-black": "#2F2E2A",
  "ansi-red": "#C55050",
  "ansi-green": "#2E8F61",
  "ansi-yellow": "#A87314",
  "ansi-blue": "#3D70AE",
  "ansi-magenta": "#7D5DC0",
  "ansi-cyan": "#2B7F91",
  "ansi-white": "#FBFAF7",
  "ansi-bright-black": "#5F5B52",
  "ansi-bright-red": "#DD7272",
  "ansi-bright-green": "#45A879",
  "ansi-bright-yellow": "#BB8E2B",
  "ansi-bright-blue": "#5A8BC2",
  "ansi-bright-magenta": "#A27BD4",
  "ansi-bright-cyan": "#49A4B0",
  "ansi-bright-white": "#FFFFFF",
  "token-link": "#9D6911",
  "token-string": "#278553",
  "token-comment": "#7C766D",
  "token-constant": "#6E56B5",
  "token-keyword": "#8C5910",
  "token-parameter": "#8E6630",
  "token-function": "#2C5D92",
  "token-string-expression": "#A66F18",
  "token-punctuation": "#6F695F",
  "token-inserted": "#2E8F61",
  "token-deleted": "#C55050",
  "token-changed": "#A87314",
} as const;

const rovexThemeRegistryFlag = "__rovexDiffThemesRegistered";

function registerRovexDiffThemes() {
  const registry = globalThis as typeof globalThis & {
    [rovexThemeRegistryFlag]?: boolean;
  };
  if (registry[rovexThemeRegistryFlag]) return;

  registerCustomCSSVariableTheme("rovex-dark", rovexDarkThemeDefaults, true);
  registerCustomCSSVariableTheme("rovex-light", rovexLightThemeDefaults, true);
  registry[rovexThemeRegistryFlag] = true;
}

registerRovexDiffThemes();

export type DiffViewerTheme = {
  dark: string;
  light: string;
};

export type DiffViewerAnnotation = {
  id: string;
  filePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  title: string;
  body: string;
  severity: "critical" | "high" | "medium" | "low" | string;
  chunkId?: string | null;
};

export type DiffViewerInlineComment = {
  id: string;
  filePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  endSide?: "additions" | "deletions" | null;
  endLineNumber?: number | null;
  body: string;
  author: string;
  createdAt: string;
};

export type DiffViewerCreateInlineCommentInput = {
  filePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  endSide?: "additions" | "deletions";
  endLineNumber?: number;
  body: string;
};

type DiffViewerAnnotationMetadata = {
  source: "ai";
  id: string;
  title: string;
  body: string;
  severity: string;
  chunkId?: string | null;
} | {
  source: "comment";
  id: string;
  title: string;
  body: string;
  severity: string;
  author: string;
  createdAtLabel: string;
} | {
  source: "composer";
  id: string;
  title: string;
  body: string;
  severity: string;
  lineLabel: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onAddToChat?: () => void;
  onSuggest?: () => void;
  submitting: boolean;
};

type DiffViewerLineTarget = {
  filePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  endLineNumber?: number;
};

type DiffViewerProps = {
  patch: string;
  theme: DiffViewerTheme;
  themeId?: string;
  themeType?: "system" | "light" | "dark";
  showToolbar?: boolean;
  focusTarget?: {
    filePath: string;
    lineNumber: number | null;
    findingId: string | null;
    side: "additions" | "deletions" | string | null;
  } | null;
  collapseStateKey?: string;
  annotations?: DiffViewerAnnotation[];
  inlineComments?: DiffViewerInlineComment[];
  onCreateInlineComment?: (
    input: DiffViewerCreateInlineCommentInput
  ) => void | Promise<unknown>;
  onAskAiAboutFile?: (filePath: string, contextNote?: string, lineLabel?: string) => void;
  onOpenFile?: (filePath: string) => void | Promise<void>;
};

type DiffFileCardProps = {
  file: FileDiffMetadata;
  initiallyVisible: boolean;
  initiallyCollapsed?: boolean;
  fastMode: boolean;
  options: DiffRenderOptions;
  lineAnnotations: Accessor<DiffLineAnnotation<DiffViewerAnnotationMetadata>[]>;
  onCollapsedChange?: (filePath: string, collapsed: boolean) => void;
  onAskAiAboutFile?: (filePath: string, contextNote?: string, lineLabel?: string) => void;
  onOpenFile?: (filePath: string) => void | Promise<void>;
  onLineNumberClick?: (target: DiffViewerLineTarget) => void;
  onLineClick?: (target: DiffViewerLineTarget) => void;
  onLineSelectionChange?: (target: DiffViewerLineTarget | null) => void;
  pendingSelectionTarget?: DiffViewerLineTarget | null;
  onAddCommentForSelection?: (target: DiffViewerLineTarget) => void;
  onRendered?: (filePath: string, renderMs: number) => void;
};

type DiffRenderOptions = Pick<
  FileDiffOptions<DiffViewerAnnotationMetadata>,
  | "diffStyle"
  | "disableLineNumbers"
  | "disableBackground"
  | "overflow"
  | "theme"
  | "themeType"
  | "unsafeCSS"
  | "renderAnnotation"
  | "onLineClick"
  | "onLineNumberClick"
  | "enableLineSelection"
  | "onLineSelected"
  | "onLineSelectionEnd"
>;

type DiffViewerProfileState = {
  parseMs: number;
  renderMs: number;
  renderedFiles: number;
};

type ParsedDiffState = {
  files: FileDiffMetadata[];
  parseError: string | null;
  parseMs: number;
};

const FAST_DIFF_PATCH_BYTES_THRESHOLD = 200_000;
const FAST_DIFF_FILE_COUNT_THRESHOLD = 20;
const FAST_DIFF_TOTAL_LINE_THRESHOLD = 3_000;
const FAST_DIFF_FILE_LINE_THRESHOLD = 500;
const HUGE_FILE_FAST_PATH_LINE_THRESHOLD = 2_000;
const DEFAULT_INITIAL_VISIBLE_FILES = 3;
const FAST_INITIAL_VISIBLE_FILES = 1;
const DIFF_PROFILE_STORAGE_KEY = "rovex.profile.diff";
const DIFF_COLLAPSE_DEBUG_STORAGE_KEY = "rovex.debug.diff-collapse";
const DIFF_UNIFIED_STYLE_STORAGE_KEY = "rovex.diff.unified-style";
const DIFF_COLLAPSED_FILES_STORAGE_PREFIX = "rovex.diff.collapsed-files.";
const EMPTY_LINE_ANNOTATIONS: DiffLineAnnotation<DiffViewerAnnotationMetadata>[] = [];

function logDiffCommentEvent(event: string, payload?: unknown) {
  const formatPayload = () => {
    if (payload === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return payload;
    }
  };
  const formattedPayload = formatPayload();
  if (payload === undefined) {
    console.info(`[rovex diff comments] ${event}`);
    return;
  }
  console.info(`[rovex diff comments] ${event}`, formattedPayload);
}
const diffCollapseUnsafeCSS = `
:host([data-rovex-collapsed="1"]) pre,
:host([data-rovex-collapsed="1"]) [data-error-wrapper] {
  display: none;
}

[data-diffs-header] {
  position: sticky;
  top: 0;
  z-index: 3;
  background: rgba(11, 16, 23, 0.94);
  backdrop-filter: blur(3px);
}

[data-diffs-header][data-rovex-openable="1"] [data-header-content] [data-title],
[data-diffs-header][data-rovex-openable="1"] [data-header-content] [data-prev-name] {
  cursor: pointer;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: color-mix(in lab, var(--diffs-fg) 40%, transparent);
}

[data-diffs-header][data-rovex-openable="1"] [data-header-content] [data-title]:hover,
[data-diffs-header][data-rovex-openable="1"] [data-header-content] [data-prev-name]:hover {
  text-decoration-color: color-mix(in lab, var(--diffs-fg) 80%, transparent);
}
`;
let diffCollapseCardCounter = 0;

function isDiffProfileEnabled() {
  try {
    return globalThis.localStorage?.getItem(DIFF_PROFILE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function isDiffCollapseDebugEnabled() {
  try {
    return globalThis.localStorage?.getItem(DIFF_COLLAPSE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getStoredUnifiedStylePreference() {
  try {
    return globalThis.localStorage?.getItem(DIFF_UNIFIED_STYLE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function areLineAnnotationsEqual(
  left: DiffLineAnnotation<DiffViewerAnnotationMetadata>[],
  right: DiffLineAnnotation<DiffViewerAnnotationMetadata>[]
) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (leftEntry.side !== rightEntry.side || leftEntry.lineNumber !== rightEntry.lineNumber) {
      return false;
    }
    const leftMetadata = leftEntry.metadata;
    const rightMetadata = rightEntry.metadata;
    if (leftMetadata?.source !== rightMetadata?.source) return false;
    if (
      leftMetadata?.id !== rightMetadata?.id ||
      leftMetadata?.title !== rightMetadata?.title ||
      leftMetadata?.body !== rightMetadata?.body ||
      leftMetadata?.severity !== rightMetadata?.severity
    ) {
      return false;
    }
    if (
      leftMetadata?.source === "ai" &&
      rightMetadata?.source === "ai" &&
      leftMetadata.chunkId !== rightMetadata.chunkId
    ) {
      return false;
    }
    if (
      leftMetadata?.source === "comment" &&
      rightMetadata?.source === "comment" &&
      (leftMetadata.author !== rightMetadata.author ||
        leftMetadata.createdAtLabel !== rightMetadata.createdAtLabel)
    ) {
      return false;
    }
    if (
      leftMetadata?.source === "composer" &&
      rightMetadata?.source === "composer" &&
      leftMetadata.submitting !== rightMetadata.submitting
    ) {
      return false;
    }
  }
  return true;
}

function normalizeDiffPath(path: string | null | undefined) {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/^([ab])\//, "");
  return normalized;
}

function areStringSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const entry of left) {
    if (!right.has(entry)) return false;
  }
  return true;
}

function getDiffCollapsedFilesStorageKey(scope: string) {
  return `${DIFF_COLLAPSED_FILES_STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

function readStoredCollapsedFilePaths(scope: string) {
  if (!scope) return new Set<string>();
  try {
    const raw = globalThis.localStorage?.getItem(getDiffCollapsedFilesStorageKey(scope));
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    const paths = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const normalized = normalizeDiffPath(entry);
      if (normalized) paths.add(normalized);
    }
    return paths;
  } catch {
    return new Set<string>();
  }
}

function writeStoredCollapsedFilePaths(scope: string, paths: Set<string>) {
  if (!scope) return;
  const storageKey = getDiffCollapsedFilesStorageKey(scope);
  try {
    if (paths.size === 0) {
      globalThis.localStorage?.removeItem(storageKey);
      return;
    }
    const serialized = JSON.stringify([...paths].sort((left, right) => left.localeCompare(right)));
    globalThis.localStorage?.setItem(storageKey, serialized);
  } catch {
    // Persisting this preference is best-effort only.
  }
}

function getAnnotationLocationKey(target: DiffViewerLineTarget) {
  const endLineNumber =
    target.endLineNumber != null && target.endLineNumber !== target.lineNumber
      ? target.endLineNumber
      : target.lineNumber;
  return `${target.filePath}::${target.side}::${target.lineNumber}::${endLineNumber}`;
}

function areLineTargetsEqual(left: DiffViewerLineTarget | null, right: DiffViewerLineTarget | null) {
  if (left == null || right == null) return left === right;
  const leftEnd = left.endLineNumber ?? left.lineNumber;
  const rightEnd = right.endLineNumber ?? right.lineNumber;
  return (
    left.filePath === right.filePath &&
    left.side === right.side &&
    left.lineNumber === right.lineNumber &&
    leftEnd === rightEnd
  );
}

function getAnnotationSourcePriority(
  metadata: DiffViewerAnnotationMetadata | undefined
) {
  if (!metadata) return 0;
  if (metadata.source === "ai") return 0;
  if (metadata.source === "comment") return 1;
  return 2;
}

function formatInlineCommentTimestamp(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHour = ((hours + 11) % 12) + 1;
  return `${normalizedHour}:${minutes} ${suffix}`;
}

function formatInlineCommentCreatedAt(raw: string) {
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return formatInlineCommentTimestamp(new Date(parsed));
  }
  return raw;
}

function normalizeLineTarget(target: DiffViewerLineTarget): DiffViewerLineTarget | null {
  const filePath = normalizeDiffPath(target.filePath);
  if (!filePath) return null;
  const lineNumber = Number.isFinite(target.lineNumber)
    ? Math.max(1, Math.floor(target.lineNumber))
    : 0;
  if (lineNumber <= 0) return null;
  const endCandidate = target.endLineNumber;
  const normalizedEnd =
    endCandidate != null && Number.isFinite(endCandidate)
      ? Math.max(1, Math.floor(endCandidate))
      : lineNumber;
  const rangeStart = Math.min(lineNumber, normalizedEnd);
  const rangeEnd = Math.max(lineNumber, normalizedEnd);
  return {
    filePath,
    side: target.side,
    lineNumber: rangeStart,
    endLineNumber: rangeEnd > rangeStart ? rangeEnd : undefined,
  };
}

function getLineTargetLabel(target: DiffViewerLineTarget) {
  const endLine = target.endLineNumber;
  if (endLine != null && endLine !== target.lineNumber) {
    return `L${target.lineNumber}-L${endLine}`;
  }
  return `L${target.lineNumber}`;
}

function getLineTargetRangeLabel(target: DiffViewerLineTarget) {
  const endLine = target.endLineNumber;
  if (endLine != null && endLine !== target.lineNumber) {
    return `${target.lineNumber}:${endLine}`;
  }
  return `${target.lineNumber}:${target.lineNumber}`;
}

function toLineTargetFromSelectedRange(
  filePath: string,
  range: SelectedLineRange | null
): DiffViewerLineTarget | null {
  if (!range) return null;
  const normalizeSide = (value: unknown): "additions" | "deletions" | null =>
    value === "additions" || value === "deletions" ? value : null;
  const startSide = normalizeSide(range.side);
  const endSide = normalizeSide(range.endSide);
  if (startSide != null && endSide != null && startSide !== endSide) {
    return null;
  }
  const sideCandidate = endSide ?? startSide;
  if (sideCandidate == null) {
    return null;
  }
  return normalizeLineTarget({
    filePath,
    side: sideCandidate,
    lineNumber: range.start,
    endLineNumber: range.end,
  });
}

function isLineTargetRange(target: DiffViewerLineTarget) {
  return target.endLineNumber != null && target.endLineNumber !== target.lineNumber;
}

function doesLineTargetMatchRange(
  rangeTarget: DiffViewerLineTarget,
  lineTarget: DiffViewerLineTarget
) {
  if (!isLineTargetRange(rangeTarget)) return false;
  if (rangeTarget.filePath !== lineTarget.filePath || rangeTarget.side !== lineTarget.side) {
    return false;
  }
  const rangeEnd = rangeTarget.endLineNumber ?? rangeTarget.lineNumber;
  return lineTarget.lineNumber >= rangeTarget.lineNumber && lineTarget.lineNumber <= rangeEnd;
}

function renderDiffAnnotation(annotation: DiffLineAnnotation<DiffViewerAnnotationMetadata>) {
  const metadata = annotation.metadata;
  if (!metadata) return undefined;

  const root = document.createElement("div");
  root.className = `rovex-inline-annotation is-${metadata.severity || "medium"}`;
  if (metadata.id) root.dataset.rovexAnnotationId = metadata.id;
  root.dataset.rovexLineNumber = String(annotation.lineNumber);
  root.dataset.rovexLineSide = annotation.side;
  root.dataset.rovexAnnotationSource = metadata.source;

  if (metadata.source === "composer") {
    logDiffCommentEvent("rendering composer annotation", {
      annotationSide: annotation.side,
      lineNumber: annotation.lineNumber,
      metadataId: metadata.id,
    });
    root.classList.add("is-comment-composer");

    /* ── Header: line range + collapse ── */
    const header = document.createElement("div");
    header.className = "rovex-composer-header";
    const headerLabel = document.createElement("span");
    headerLabel.className = "rovex-composer-header-label";
    headerLabel.textContent = `Lines ${metadata.lineLabel.replace(/^L/, "").replace(/-L/, "–")}`;
    header.appendChild(headerLabel);
    const headerChevron = document.createElement("button");
    headerChevron.type = "button";
    headerChevron.className = "rovex-composer-header-chevron";
    headerChevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    headerChevron.title = "Collapse";
    headerChevron.addEventListener("click", () => metadata.onCancel());
    header.appendChild(headerChevron);
    root.appendChild(header);

    /* ── Formatting toolbar ── */
    const toolbar = document.createElement("div");
    toolbar.className = "rovex-composer-toolbar";
    const toolbarItems: Array<{ label: string; icon: string; wrap: [string, string] }> = [
      { label: "Bold", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`, wrap: ["**", "**"] },
      { label: "Italic", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`, wrap: ["_", "_"] },
      { label: "Code", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`, wrap: ["`", "`"] },
      { label: "Code block", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>`, wrap: ["```\n", "\n```"] },
      { label: "Link", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`, wrap: ["[", "](url)"] },
      { label: "Quote", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`, wrap: ["> ", ""] },
    ];
    // Create textarea early so toolbar buttons can reference it for formatting
    const textareaRef = document.createElement("textarea");
    for (const item of toolbarItems) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rovex-composer-toolbar-btn";
      btn.title = item.label;
      btn.innerHTML = item.icon;
      btn.addEventListener("click", () => {
        if (!textareaRef) return;
        const start = textareaRef.selectionStart;
        const end = textareaRef.selectionEnd;
        const text = textareaRef.value;
        const selected = text.slice(start, end);
        const replacement = `${item.wrap[0]}${selected || item.label.toLowerCase()}${item.wrap[1]}`;
        textareaRef.value = text.slice(0, start) + replacement + text.slice(end);
        metadata.onInput(textareaRef.value);
        const cursorPos = selected
          ? start + replacement.length
          : start + item.wrap[0].length + item.label.toLowerCase().length;
        textareaRef.focus();
        textareaRef.setSelectionRange(
          selected ? start + item.wrap[0].length : start + item.wrap[0].length,
          selected ? start + item.wrap[0].length + selected.length : cursorPos,
        );
      });
      toolbar.appendChild(btn);
    }
    root.appendChild(toolbar);

    /* ── Separator ── */
    const sep = document.createElement("div");
    sep.className = "rovex-composer-separator";
    root.appendChild(sep);

    /* ── Textarea (borderless inside card) ── */
    textareaRef.className = "rovex-inline-comment-textarea";
    textareaRef.placeholder = "Leave a comment...";
    textareaRef.value = metadata.body;
    textareaRef.rows = 4;
    textareaRef.disabled = metadata.submitting;
    textareaRef.addEventListener("input", () => {
      metadata.onInput(textareaRef.value);
    });
    textareaRef.addEventListener("keydown", (event) => {
      if (metadata.submitting) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const value = textareaRef.value.trim();
        if (value.length === 0) return;
        metadata.onSubmit(value);
      }
    });
    root.appendChild(textareaRef);

    /* ── Bottom action bar ── */
    const actions = document.createElement("div");
    actions.className = "rovex-composer-actions";

    const actionsLeft = document.createElement("div");
    actionsLeft.className = "rovex-composer-actions-left";

    const suggestBtn = document.createElement("button");
    suggestBtn.type = "button";
    suggestBtn.className = "rovex-composer-action-btn";
    suggestBtn.textContent = "Suggest";
    suggestBtn.disabled = metadata.submitting;
    suggestBtn.addEventListener("click", () => {
      if (metadata.onSuggest) {
        metadata.onSuggest();
      }
    });
    actionsLeft.appendChild(suggestBtn);

    if (metadata.onAddToChat) {
      const addToChatBtn = document.createElement("button");
      addToChatBtn.type = "button";
      addToChatBtn.className = "rovex-composer-action-btn is-chat";
      addToChatBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Add to Chat</span>`;
      addToChatBtn.disabled = metadata.submitting;
      addToChatBtn.addEventListener("click", () => metadata.onAddToChat?.());
      actionsLeft.appendChild(addToChatBtn);
    }
    actions.appendChild(actionsLeft);

    const actionsRight = document.createElement("div");
    actionsRight.className = "rovex-composer-actions-right";

    const isMac = navigator.platform?.toLowerCase().includes("mac") ?? false;
    const shortcutHint = document.createElement("span");
    shortcutHint.className = "rovex-inline-comment-hint";
    shortcutHint.textContent = `${isMac ? "⌘" : "Ctrl"}+Enter to comment`;
    actionsRight.appendChild(shortcutHint);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "rovex-composer-action-btn";
    cancelButton.textContent = "Cancel";
    cancelButton.disabled = metadata.submitting;
    cancelButton.addEventListener("click", () => metadata.onCancel());
    actionsRight.appendChild(cancelButton);

    actions.appendChild(actionsRight);
    root.appendChild(actions);

    queueMicrotask(() => {
      if (metadata.submitting) return;
      if (!textareaRef.isConnected) return;
      textareaRef.focus();
      textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
    });
    return root;
  }

  const titleRow = document.createElement("div");
  titleRow.className = "rovex-inline-annotation-title";
  titleRow.textContent = metadata.title;
  root.appendChild(titleRow);

  const body = document.createElement("p");
  body.className = "rovex-inline-annotation-body";
  body.textContent = metadata.body;
  root.appendChild(body);

  if (metadata.source === "comment") {
    const footer = document.createElement("div");
    footer.className = "rovex-inline-annotation-footer";
    footer.textContent = metadata.createdAtLabel;
    root.appendChild(footer);
  }

  if (metadata.source === "ai" && metadata.chunkId) {
    const footer = document.createElement("div");
    footer.className = "rovex-inline-annotation-footer";
    footer.textContent = metadata.chunkId;
    root.appendChild(footer);
  }

  return root;
}

function DiffFileCard(props: DiffFileCardProps) {
  const debugCardId = ++diffCollapseCardCounter;
  const debugFileName = props.file.name;
  const debugLog = (...args: unknown[]) => {
    if (!isDiffCollapseDebugEnabled()) return;
    console.debug(`[rovex diff collapse] #${debugCardId} ${debugFileName}`, ...args);
  };

  let visibilityAnchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let instance: FileDiff<DiffViewerAnnotationMetadata> | undefined;
  let previousRenderOptions: DiffRenderOptions | undefined;
  let collapseToggleButton: HTMLButtonElement | undefined;
  let askAiButtonHost: HTMLDivElement | undefined;
  let disposeAskAiButton: (() => void) | undefined;
  let headerMetadataControls: HTMLDivElement | undefined;
  let headerElement: HTMLElement | undefined;
  let headerObserver: MutationObserver | undefined;
  let profiledInitialRender = false;
  const [shouldRender, setShouldRender] = createSignal(props.initiallyVisible);
  const [collapsed, setCollapsed] = createSignal(props.initiallyCollapsed ?? false);
  const [renderError, setRenderError] = createSignal<string | null>(null);

  debugLog("init", {
    initiallyVisible: props.initiallyVisible,
    unifiedLines: props.file.unifiedLineCount,
    splitLines: props.file.splitLineCount,
  });

  const syncCollapseToggleButton = () => {
    if (collapseToggleButton == null) {
      debugLog("syncCollapseToggleButton skipped (no button)");
      return;
    }
    const isCollapsed = collapsed();
    collapseToggleButton.dataset.collapsed = isCollapsed ? "1" : "0";
    collapseToggleButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    collapseToggleButton.setAttribute(
      "aria-label",
      isCollapsed ? "Expand file diff" : "Collapse file diff"
    );
    collapseToggleButton.title = isCollapsed ? "Expand file diff" : "Collapse file diff";
    debugLog("syncCollapseToggleButton", {
      collapsed: isCollapsed,
      connected: collapseToggleButton.isConnected,
    });
  };

  const syncHeaderAccessibility = () => {
    if (headerElement == null) {
      debugLog("syncHeaderAccessibility skipped (no header)");
      return;
    }
    const isCollapsed = collapsed();
    headerElement.setAttribute("role", "button");
    headerElement.tabIndex = 0;
    headerElement.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    debugLog("syncHeaderAccessibility", { collapsed: isCollapsed });
  };

  const handleHeaderClick = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".rovex-diff-header-action") != null
    ) {
      debugLog("header click ignored (action button target)");
      return;
    }
    if (target instanceof Element && props.onOpenFile) {
      const fileNameTarget = target.closest(
        "[data-header-content] [data-title], [data-header-content] [data-prev-name]"
      );
      const filePath = getNormalizedFilePath();
      if (fileNameTarget && filePath.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        debugLog("header file name click opens file", { filePath });
        props.onOpenFile(filePath);
        return;
      }
    }
    debugLog("header click toggles");
    toggleCollapsedState();
  };

  const handleHeaderKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".rovex-diff-header-action") != null
    ) {
      debugLog("header keydown ignored (action button target)");
      return;
    }
    debugLog("header keydown toggles", { key: event.key });
    event.preventDefault();
    toggleCollapsedState();
  };

  const bindHeaderInteraction = () => {
    const container = containerRef;
    if (!container) {
      debugLog("bindHeaderInteraction skipped (no container)");
      return;
    }
    const fileContainer = container.querySelector("diffs-container");
    if (!(fileContainer instanceof HTMLElement)) {
      debugLog("bindHeaderInteraction skipped (no fileContainer)");
      return;
    }
    const shadowRoot = fileContainer.shadowRoot;
    if (shadowRoot == null) {
      debugLog("bindHeaderInteraction skipped (no shadowRoot)");
      return;
    }

    const nextHeader = shadowRoot.querySelector("[data-diffs-header]");
    if (!(nextHeader instanceof HTMLElement)) {
      debugLog("bindHeaderInteraction skipped (no header)");
      return;
    }

    if (headerElement !== nextHeader) {
      if (headerElement != null) {
        headerElement.removeEventListener("click", handleHeaderClick);
        headerElement.removeEventListener("keydown", handleHeaderKeydown);
        debugLog("rebound header listeners from replaced header");
      }
      headerElement = nextHeader;
      headerElement.addEventListener("click", handleHeaderClick);
      headerElement.addEventListener("keydown", handleHeaderKeydown);
      debugLog("bound header listeners");
    }
    const canOpenFile = props.onOpenFile != null && getNormalizedFilePath().length > 0;
    if (canOpenFile) {
      nextHeader.dataset.rovexOpenable = "1";
    } else {
      delete nextHeader.dataset.rovexOpenable;
    }
    syncHeaderAccessibility();

    if (headerObserver == null) {
      headerObserver = new MutationObserver(() => {
        debugLog("header observer mutation");
        bindHeaderInteraction();
      });
      headerObserver.observe(shadowRoot, { childList: true, subtree: false });
      debugLog("header observer attached");
    }
  };

  const syncCollapsedHostAttribute = () => {
    const container = containerRef;
    if (!container) {
      debugLog("collapsed sync skipped (no container)");
      return;
    }
    const fileContainer = container.querySelector("diffs-container");
    if (!(fileContainer instanceof HTMLElement)) {
      debugLog("collapsed sync skipped (no fileContainer)");
      return;
    }
    if (collapsed()) {
      fileContainer.setAttribute("data-rovex-collapsed", "1");
      debugLog("applied collapsed host attr");
      return;
    }
    fileContainer.removeAttribute("data-rovex-collapsed");
    debugLog("removed collapsed host attr");
  };

  const getCollapseToggleButton = () => {
    if (collapseToggleButton == null) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rovex-diff-header-action rovex-diff-collapse-toggle";
      const icon = document.createElement("span");
      icon.className = "rovex-diff-collapse-toggle-icon";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        debugLog("metadata toggle button click");
        toggleCollapsedState();
      });
      collapseToggleButton = button;
      debugLog("created collapse toggle button");
    }
    syncCollapseToggleButton();
    debugLog("getCollapseToggleButton", {
      connected: collapseToggleButton.isConnected,
    });
    return collapseToggleButton;
  };

  const getNormalizedFilePath = () => {
    const normalizedName = normalizeDiffPath(props.file.name);
    if (normalizedName) return normalizedName;
    return normalizeDiffPath(props.file.prevName);
  };

  const setCollapsedState = (nextCollapsed: boolean) => {
    setCollapsed((current) => {
      if (current === nextCollapsed) return current;
      const filePath = getNormalizedFilePath();
      if (filePath) {
        props.onCollapsedChange?.(filePath, nextCollapsed);
      }
      return nextCollapsed;
    });
  };

  const toggleCollapsedState = () => {
    setCollapsedState(!collapsed());
  };

  const getAskAiButton = () => {
    if (!props.onAskAiAboutFile) return undefined;
    if (askAiButtonHost == null) {
      const filePath = getNormalizedFilePath();
      const canShare = filePath.length > 0;
      const tooltipLabel = canShare
        ? `Ask AI about ${filePath}`
        : "Ask AI about this file";
      const host = document.createElement("div");
      host.className = "rovex-diff-ai-button-host";
      disposeAskAiButton = renderSolid(
        () => (
          <Tooltip openDelay={120} closeDelay={90}>
            <TooltipTrigger>
              <button
                type="button"
                class="rovex-diff-header-action rovex-diff-ai-button"
                aria-label={tooltipLabel}
                disabled={!canShare}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!canShare) return;
                  debugLog("metadata ai button click", { filePath });
                  props.onAskAiAboutFile?.(filePath);
                }}
              >
                <Sparkles class="rovex-diff-ai-button-icon" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{tooltipLabel}</TooltipContent>
          </Tooltip>
        ),
        host
      );
      askAiButtonHost = host;
      debugLog("created ask ai button");
    }
    return askAiButtonHost;
  };

  const getHeaderMetadataControls = () => {
    if (headerMetadataControls == null) {
      const controls = document.createElement("div");
      controls.className = "rovex-diff-header-controls";
      headerMetadataControls = controls;
      debugLog("created header metadata controls");
    }
    const controls = headerMetadataControls;
    controls.replaceChildren();

    const aiButton = getAskAiButton();
    if (aiButton) controls.appendChild(aiButton);
    controls.appendChild(getCollapseToggleButton());

    return controls;
  };

  createEffect(() => {
    props.file.name;
    props.file.prevName;
    setCollapsed(props.initiallyCollapsed ?? false);
  });

  createEffect(() => {
    const anchor = visibilityAnchorRef;
    if (!anchor) {
      debugLog("intersection setup skipped (no anchor)");
      return;
    }
    debugLog("intersection setup", { fastMode: props.fastMode });
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          debugLog("intersection observed -> shouldRender true");
          setShouldRender(true);
        }
      },
      { rootMargin: props.fastMode ? "900px 0px" : "1400px 0px" }
    );
    observer.observe(anchor);
    onCleanup(() => {
      debugLog("intersection cleanup");
      observer.disconnect();
    });
  });

  createEffect(() => {
    const visible = shouldRender();
    const isCollapsed = collapsed();
    debugLog("render effect tick", { shouldRender: visible, collapsed: isCollapsed });
    if (!visible) {
      debugLog("render effect skip", {
        reason: "shouldRender=false",
      });
      return;
    }
    if (isCollapsed && instance) {
      debugLog("render effect skip", {
        reason: "collapsed=true and instance already initialized",
      });
      return;
    }

    const container = containerRef;
    if (!container) {
      debugLog("render effect skip (no container)");
      return;
    }

    try {
      const fileLineCount = Math.max(props.file.unifiedLineCount, props.file.splitLineCount);
      const useHugeFileFastPath = fileLineCount >= HUGE_FILE_FAST_PATH_LINE_THRESHOLD;
      const useFastFileMode =
        props.fastMode || fileLineCount >= FAST_DIFF_FILE_LINE_THRESHOLD || useHugeFileFastPath;

      const fileOptions: FileDiffOptions<DiffViewerAnnotationMetadata> = {
        ...props.options,
        hunkSeparators: () => document.createDocumentFragment(),
        diffStyle: useHugeFileFastPath ? "unified" : props.options.diffStyle,
        disableLineNumbers: useHugeFileFastPath ? true : props.options.disableLineNumbers,
        lineDiffType: useFastFileMode ? "none" : "word",
        maxLineDiffLength: useHugeFileFastPath ? 60 : useFastFileMode ? 120 : 280,
        tokenizeMaxLineLength: useHugeFileFastPath ? 120 : useFastFileMode ? 280 : 900,
        renderHeaderMetadata: () => getHeaderMetadataControls(),
        enableLineSelection: true,
        onLineSelected: (range) => {
          const normalizedPath = getNormalizedFilePath();
          if (!normalizedPath) return;
          const target = toLineTargetFromSelectedRange(normalizedPath, range);
          logDiffCommentEvent("onLineSelected", {
            filePath: normalizedPath,
            range,
            target,
          });
          props.onLineSelectionChange?.(target);
        },
        onLineSelectionEnd: (range: SelectedLineRange | null) => {
          const normalizedPath = getNormalizedFilePath();
          if (!normalizedPath) return;
          const target = toLineTargetFromSelectedRange(normalizedPath, range);
          logDiffCommentEvent("onLineSelectionEnd", {
            filePath: normalizedPath,
            range,
            target,
          });
          props.onLineSelectionChange?.(target);
          if (target && isLineTargetRange(target)) {
            props.onAddCommentForSelection?.(target);
          }
        },
        onLineClick: (lineEvent) => {
          const normalizedPath = getNormalizedFilePath();
          if (!normalizedPath) return;
          props.onLineClick?.({
            filePath: normalizedPath,
            lineNumber: lineEvent.lineNumber,
            side: lineEvent.annotationSide === "deletions" ? "deletions" : "additions",
          });
        },
        onLineNumberClick: (lineEvent) => {
          const normalizedPath = getNormalizedFilePath();
          if (!normalizedPath) return;
          props.onLineNumberClick?.({
            filePath: normalizedPath,
            lineNumber: lineEvent.lineNumber,
            side: lineEvent.annotationSide === "deletions" ? "deletions" : "additions",
          });
        },
      };
      if (!instance) {
        container.replaceChildren();
        instance = new FileDiff(fileOptions);
      } else {
        instance.setOptions(fileOptions);
      }

      const renderStart = performance.now();
      const fileDiff = useHugeFileFastPath
        ? ({ ...props.file, lang: "text" } as FileDiffMetadata)
        : props.file;
      const optionsChanged = previousRenderOptions !== props.options;
      const lineAnnotations = props.lineAnnotations();
      const lineAnnotationsForRender =
        useHugeFileFastPath && lineAnnotations.length === 0
          ? EMPTY_LINE_ANNOTATIONS
          : lineAnnotations;
      logDiffCommentEvent("render file annotations", {
        filePath: getNormalizedFilePath(),
        totalAnnotations: lineAnnotationsForRender.length,
        composerAnnotations: lineAnnotationsForRender.filter(
          (entry) => entry.metadata?.source === "composer"
        ).length,
        annotationSources: lineAnnotationsForRender.map((entry) => entry.metadata?.source ?? "none"),
      });
      instance.render({
        fileDiff,
        containerWrapper: container,
        lineAnnotations: lineAnnotationsForRender,
        forceRender: optionsChanged,
      });
      previousRenderOptions = props.options;
      debugLog("render complete");
      bindHeaderInteraction();
      syncCollapsedHostAttribute();
      const renderMs = performance.now() - renderStart;
      if (!profiledInitialRender) {
        props.onRendered?.(props.file.name, renderMs);
        profiledInitialRender = true;
      }
      setRenderError(null);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    }
  });

  createEffect(() => {
    debugLog("collapsed sync effect tick", { collapsed: collapsed() });
    syncCollapseToggleButton();
    syncHeaderAccessibility();
    syncCollapsedHostAttribute();
  });

  onCleanup(() => {
    debugLog("cleanup");
    headerObserver?.disconnect();
    if (headerElement != null) {
      headerElement.removeEventListener("click", handleHeaderClick);
      headerElement.removeEventListener("keydown", handleHeaderKeydown);
      headerElement = undefined;
    }
    disposeAskAiButton?.();
    askAiButtonHost = undefined;
    disposeAskAiButton = undefined;
    instance?.cleanUp();
    containerRef?.replaceChildren();
  });

  return (
    <section
      ref={sectionRef}
      class="rovex-diff-file"
      data-rovex-file-path={getNormalizedFilePath() || undefined}
    >
      {/* Floating selection button removed — comment composer opens on line click */}
      <div ref={visibilityAnchorRef}>
        <Show when={renderError()}>
          {(message) => (
            <div class="mx-3 mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300/90">
              Failed to render file diff: {message()}
            </div>
          )}
        </Show>
        <Show
          when={shouldRender()}
          fallback={
            <div class="rovex-diff-file-placeholder">
              Scroll to load this file diff.
            </div>
          }
        >
          <div ref={containerRef} />
        </Show>
      </div>
    </section>
  );
}

export function DiffViewer(props: DiffViewerProps) {
  let viewerRootRef: HTMLDivElement | undefined;
  const showToolbar = createMemo(() => props.showToolbar ?? true);
  const themeClass = createMemo(() =>
    props.themeId?.trim() ? `rovex-diff-theme-${props.themeId}` : ""
  );
  const collapseStateScope = createMemo(() => props.collapseStateKey?.trim() ?? "");
  const profileEnabled = createMemo(() => isDiffProfileEnabled());
  const [lineWrap, setLineWrap] = createSignal(true);
  const [lineNumbers, setLineNumbers] = createSignal(true);
  const [unifiedStyle, setUnifiedStyle] = createSignal(getStoredUnifiedStylePreference());
  const [disableBackground, setDisableBackground] = createSignal(false);
  const [collapsedFilePaths, setCollapsedFilePaths] = createSignal<Set<string>>(new Set());
  const [commentTarget, setCommentTarget] = createSignal<DiffViewerLineTarget | null>(null);
  const [pendingSelectionTarget, setPendingSelectionTarget] =
    createSignal<DiffViewerLineTarget | null>(null);
  const [draftValuesByLocation, setDraftValuesByLocation] = createSignal<Record<string, string>>({});
  const [submittingDraftLocations, setSubmittingDraftLocations] = createSignal<Set<string>>(new Set());
  const [profileState, setProfileState] = createSignal<DiffViewerProfileState>({
    parseMs: 0,
    renderMs: 0,
    renderedFiles: 0,
  });

  const handleLineNumberClick = (target: DiffViewerLineTarget) => {
    const normalizedTarget = normalizeLineTarget(target);
    if (!normalizedTarget) return;
    const pendingTarget = pendingSelectionTarget();
    const nextTarget =
      pendingTarget && doesLineTargetMatchRange(pendingTarget, normalizedTarget)
        ? pendingTarget
        : normalizedTarget;
    setPendingSelectionTarget(null);
    if (isLineTargetRange(nextTarget)) {
      setCommentTarget(nextTarget);
      return;
    }
    setCommentTarget((current) => (
      areLineTargetsEqual(current, nextTarget) ? null : nextTarget
    ));
  };

  const handleLineClick = (target: DiffViewerLineTarget) => {
    const normalizedTarget = normalizeLineTarget(target);
    if (!normalizedTarget) return;
    setPendingSelectionTarget(null);
    setCommentTarget(normalizedTarget);
  };

  const handleLineSelectionChange = (target: DiffViewerLineTarget | null) => {
    logDiffCommentEvent("handleLineSelectionChange", { target });
    if (target == null) {
      setPendingSelectionTarget(null);
      return;
    }
    const normalizedTarget = normalizeLineTarget(target);
    if (!normalizedTarget) {
      setPendingSelectionTarget(null);
      return;
    }
    setPendingSelectionTarget(normalizedTarget);
  };

  const handleAddCommentForSelection = (targetOverride?: DiffViewerLineTarget) => {
    const baseTarget = targetOverride ?? pendingSelectionTarget();
    const target = baseTarget ? normalizeLineTarget(baseTarget) : null;
    logDiffCommentEvent("handleAddCommentForSelection", {
      targetOverride,
      pendingSelectionTarget: pendingSelectionTarget(),
      baseTarget,
      normalizedTarget: target,
    });
    if (!target) return;
    setPendingSelectionTarget(target);
    setCommentTarget(target);
  };

  const handleCommentDraftInput = (target: DiffViewerLineTarget, value: string) => {
    const key = getAnnotationLocationKey(target);
    setDraftValuesByLocation((current) => {
      if (current[key] === value) return current;
      return { ...current, [key]: value };
    });
  };

  const handleCommentDraftCancel = (target: DiffViewerLineTarget) => {
    const key = getAnnotationLocationKey(target);
    setCommentTarget((current) => {
      if (!areLineTargetsEqual(current, target)) return current;
      return null;
    });
    setDraftValuesByLocation((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleCommentDraftSubmit = (target: DiffViewerLineTarget, rawBody: string) => {
    const body = rawBody.trim();
    if (body.length === 0) return;
    const key = getAnnotationLocationKey(target);
    if (submittingDraftLocations().has(key)) return;
    const createComment = props.onCreateInlineComment;
    if (!createComment) {
      handleCommentDraftCancel(target);
      return;
    }
    setSubmittingDraftLocations((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    void Promise.resolve(
      createComment({
        filePath: target.filePath,
        side: target.side,
        lineNumber: target.lineNumber,
        endSide: target.endLineNumber != null ? target.side : undefined,
        endLineNumber: target.endLineNumber,
        body,
      })
    )
      .then(() => {
        handleCommentDraftCancel(target);
      })
      .catch((error) => {
        console.error("[rovex diff] Failed to create inline comment:", error);
      })
      .finally(() => {
        setSubmittingDraftLocations((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  };

  const renderOptions = createMemo<DiffRenderOptions>(() => ({
    overflow: lineWrap() ? "wrap" : "scroll",
    disableLineNumbers: !lineNumbers(),
    diffStyle: unifiedStyle() ? "unified" : "split",
    disableBackground: disableBackground(),
    theme: props.theme,
    themeType: props.themeType ?? "dark",
    unsafeCSS: diffCollapseUnsafeCSS,
    renderAnnotation: renderDiffAnnotation,
  }));

  const [parsedDiff, setParsedDiff] = createSignal<ParsedDiffState>({
    files: [],
    parseError: null,
    parseMs: 0,
  });

  createEffect(() => {
    const patchText = props.patch.trim();
    setParsedDiff({ files: [], parseError: null, parseMs: 0 });
    if (patchText.length === 0) {
      return;
    }

    let disposed = false;

    const finishParse = (state: ParsedDiffState) => {
      if (disposed) return;
      setParsedDiff(state);
    };

    if (typeof Worker !== "undefined") {
      const worker = new Worker(new URL("./diff-parse.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (
        event: MessageEvent<
          | { ok: true; files: FileDiffMetadata[]; parseMs: number }
          | { ok: false; error: string; parseMs: number }
        >
      ) => {
        const payload = event.data;
        if (payload.ok) {
          finishParse({ files: payload.files, parseError: null, parseMs: payload.parseMs });
        } else {
          finishParse({ files: [], parseError: payload.error, parseMs: payload.parseMs });
        }
      };
      worker.onerror = (error) => {
        finishParse({
          files: [],
          parseError: error.message || "Failed to parse diff in worker.",
          parseMs: 0,
        });
      };
      worker.postMessage({ patch: patchText });
      onCleanup(() => {
        disposed = true;
        worker.terminate();
      });
      return;
    }

    const parseStartedAt = performance.now();
    try {
      const parsedPatches = parsePatchFiles(patchText);
      const files: FileDiffMetadata[] = [];
      for (const patch of parsedPatches) {
        files.push(...patch.files);
      }
      finishParse({
        files,
        parseError: null,
        parseMs: performance.now() - parseStartedAt,
      });
    } catch (error) {
      finishParse({
        files: [],
        parseError: error instanceof Error ? error.message : String(error),
        parseMs: performance.now() - parseStartedAt,
      });
    }
    onCleanup(() => {
      disposed = true;
    });
  });

  const parseError = createMemo(() => parsedDiff().parseError);
  const files = createMemo(() => parsedDiff().files);
  const totalLineCount = createMemo(() =>
    files().reduce(
      (sum, file) => sum + Math.max(file.unifiedLineCount, file.splitLineCount),
      0
    )
  );
  const fastMode = createMemo(
    () =>
      props.patch.length >= FAST_DIFF_PATCH_BYTES_THRESHOLD ||
      files().length >= FAST_DIFF_FILE_COUNT_THRESHOLD ||
      totalLineCount() >= FAST_DIFF_TOTAL_LINE_THRESHOLD
  );
  const initialVisibleCount = createMemo(() =>
    fastMode() ? FAST_INITIAL_VISIBLE_FILES : DEFAULT_INITIAL_VISIBLE_FILES
  );
  const annotationsByFile = createMemo<
    Map<string, DiffLineAnnotation<DiffViewerAnnotationMetadata>[]>
  >((previousMap) => {
    const rawMap = new Map<string, DiffLineAnnotation<DiffViewerAnnotationMetadata>[]>();
    const pushAnnotation = (
      filePath: string,
      entry: DiffLineAnnotation<DiffViewerAnnotationMetadata>
    ) => {
      const existing = rawMap.get(filePath) ?? [];
      existing.push(entry);
      rawMap.set(filePath, existing);
    };

    for (const annotation of props.annotations ?? []) {
      const normalizedPath = normalizeDiffPath(annotation.filePath);
      if (!normalizedPath) continue;
      const side = annotation.side === "deletions" ? "deletions" : "additions";
      const lineNumber = Number(annotation.lineNumber);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      pushAnnotation(normalizedPath, {
        side,
        lineNumber,
        metadata: {
          source: "ai",
          id: annotation.id,
          title: annotation.title,
          body: annotation.body,
          severity: annotation.severity || "medium",
          chunkId: annotation.chunkId,
        },
      });
    }

    for (const comment of props.inlineComments ?? []) {
      const normalizedPath = normalizeDiffPath(comment.filePath);
      if (!normalizedPath) continue;
      const startLine = Number.isFinite(comment.lineNumber)
        ? Math.max(1, Math.floor(comment.lineNumber))
        : 0;
      if (startLine <= 0) continue;
      const endLineCandidate =
        comment.endLineNumber != null && Number.isFinite(comment.endLineNumber)
          ? Math.max(1, Math.floor(comment.endLineNumber))
          : startLine;
      const normalizedRangeStart = Math.min(startLine, endLineCandidate);
      const normalizedRangeEnd = Math.max(startLine, endLineCandidate);
      pushAnnotation(normalizedPath, {
        side: comment.side,
        lineNumber: normalizedRangeStart,
        metadata: {
          source: "comment",
          id: comment.id,
          title: comment.author,
          body: comment.body,
          severity: "note",
          author: comment.author,
          createdAtLabel: `${normalizedRangeStart === normalizedRangeEnd ? `L${normalizedRangeStart}` : `L${normalizedRangeStart}-L${normalizedRangeEnd}`} · ${formatInlineCommentCreatedAt(comment.createdAt)}`,
        },
      });
    }

    const activeTarget = commentTarget();
    if (activeTarget != null) {
      const normalizedPath = normalizeDiffPath(activeTarget.filePath);
      if (normalizedPath) {
        const locationKey = getAnnotationLocationKey(activeTarget);
        const draftBody = draftValuesByLocation()[locationKey] ?? "";
        pushAnnotation(normalizedPath, {
          side: activeTarget.side,
          lineNumber: activeTarget.lineNumber,
          metadata: {
            source: "composer",
            id: `comment-draft:${locationKey}`,
            title: "Add comment",
            lineLabel: getLineTargetLabel(activeTarget),
            body: draftBody,
            severity: "note",
            onInput: (value) => handleCommentDraftInput(activeTarget, value),
            onSubmit: (value) => handleCommentDraftSubmit(activeTarget, value),
            onCancel: () => handleCommentDraftCancel(activeTarget),
            onAddToChat: props.onAskAiAboutFile
              ? () => {
                  const body = (draftValuesByLocation()[locationKey] ?? "").trim();
                  const filePath = activeTarget.filePath;
                  const lineRef = getLineTargetRangeLabel(activeTarget);
                  const contextNote = body.length > 0
                    ? `Re: ${filePath} ${lineRef} — ${body}`
                    : `Discuss ${filePath} ${lineRef}`;
                  props.onAskAiAboutFile?.(filePath, contextNote, lineRef);
                }
              : undefined,
            submitting: submittingDraftLocations().has(locationKey),
          },
        });
      }
    }

    logDiffCommentEvent("annotations map rebuilt", {
      activeTarget,
      filesWithAnnotations: [...rawMap.keys()],
      annotationCountsByFile: [...rawMap.entries()].map(([path, entries]) => ({
        path,
        count: entries.length,
        composerCount: entries.filter((entry) => entry.metadata?.source === "composer").length,
      })),
    });

    const nextMap = new Map<string, DiffLineAnnotation<DiffViewerAnnotationMetadata>[]>();
    for (const [path, entries] of rawMap) {
      entries.sort(
        (left, right) =>
          left.lineNumber - right.lineNumber ||
          left.side.localeCompare(right.side) ||
          getAnnotationSourcePriority(left.metadata) -
            getAnnotationSourcePriority(right.metadata) ||
          (left.metadata?.id ?? "").localeCompare(right.metadata?.id ?? "")
      );
      const previousEntries = previousMap?.get(path);
      if (previousEntries && areLineAnnotationsEqual(previousEntries, entries)) {
        nextMap.set(path, previousEntries);
      } else {
        nextMap.set(path, entries);
      }
    }
    return nextMap;
  }, new Map());
  const filesLabel = createMemo(() => {
    const count = files().length;
    return `${count} file${count === 1 ? "" : "s"}`;
  });
  const profileLabel = createMemo(() => {
    if (!profileEnabled()) return null;
    const profile = profileState();
    return `parse ${profile.parseMs.toFixed(1)}ms · render ${profile.renderMs.toFixed(1)}ms (${profile.renderedFiles} file${profile.renderedFiles === 1 ? "" : "s"})`;
  });

  createEffect(() => {
    const scope = collapseStateScope();
    if (!scope) {
      setCollapsedFilePaths((current) => (current.size === 0 ? current : new Set<string>()));
      return;
    }

    const storedPaths = readStoredCollapsedFilePaths(scope);
    setCollapsedFilePaths((current) => (
      areStringSetsEqual(current, storedPaths) ? current : storedPaths
    ));
  });

  createEffect(() => {
    const scope = collapseStateScope();
    if (!scope) return;
    writeStoredCollapsedFilePaths(scope, collapsedFilePaths());
  });

  createEffect(() => {
    setProfileState((current) => ({ ...current, parseMs: parsedDiff().parseMs }));
  });

  createEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        DIFF_UNIFIED_STYLE_STORAGE_KEY,
        unifiedStyle() ? "1" : "0"
      );
    } catch {
      // Persisting this preference is best-effort only.
    }
  });

  createEffect(() => {
    props.patch;
    setCommentTarget(null);
    setPendingSelectionTarget(null);
    setDraftValuesByLocation({});
    setSubmittingDraftLocations(new Set<string>());
    setProfileState((current) => ({
      ...current,
      renderMs: 0,
      renderedFiles: 0,
    }));
  });

  createEffect(() => {
    logDiffCommentEvent("comment target changed", {
      commentTarget: commentTarget(),
      pendingSelectionTarget: pendingSelectionTarget(),
    });
  });

  const handleFileRendered = (filePath: string, renderMs: number) => {
    if (!profileEnabled()) return;
    setProfileState((current) => ({
      ...current,
      renderMs: current.renderMs + renderMs,
      renderedFiles: current.renderedFiles + 1,
    }));
    console.info(
      `[rovex diff profile] rendered ${filePath} in ${renderMs.toFixed(1)}ms`
    );
  };

  const handleFileCollapsedChange = (filePath: string, collapsed: boolean) => {
    if (!collapseStateScope()) return;
    const normalizedPath = normalizeDiffPath(filePath);
    if (!normalizedPath) return;
    setCollapsedFilePaths((current) => {
      const hasPath = current.has(normalizedPath);
      if (collapsed === hasPath) return current;
      const next = new Set(current);
      if (collapsed) {
        next.add(normalizedPath);
      } else {
        next.delete(normalizedPath);
      }
      return next;
    });
  };

  createEffect(() => {
    const focusTarget = props.focusTarget;
    if (!focusTarget) return;

    const targetFilePath = normalizeDiffPath(focusTarget.filePath);
    if (!targetFilePath) return;
    if (files().length === 0) return;

    const focusFindingId = focusTarget.findingId?.trim() || "";
    const focusLineNumber =
      typeof focusTarget.lineNumber === "number" && Number.isFinite(focusTarget.lineNumber)
        ? Math.max(1, Math.floor(focusTarget.lineNumber))
        : null;
    const normalizeFocusSide = (side: string | null | undefined) => {
      const value = side?.trim().toLowerCase();
      if (!value) return null;
      if (value === "additions" || value === "addition" || value === "added") {
        return "additions" as const;
      }
      if (value === "deletions" || value === "deletion" || value === "removed") {
        return "deletions" as const;
      }
      return null;
    };
    const focusLineSide = normalizeFocusSide(focusTarget.side);
    const wantsLineFocus = focusFindingId.length > 0 || focusLineNumber != null;

    const escapeSelectorValue = (value: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/"/g, '\\"');

    setCollapsedFilePaths((current) => {
      if (!current.has(targetFilePath)) return current;
      const next = new Set(current);
      next.delete(targetFilePath);
      return next;
    });

    let canceled = false;
    const maxAttempts = 12;
    const focusFileAndLine = (attempt: number) => {
      if (canceled) return;
      const viewerRoot = viewerRootRef;
      if (!viewerRoot) return;
      const escapedPath = escapeSelectorValue(targetFilePath);
      const targetFile = viewerRoot.querySelector<HTMLElement>(
        `[data-rovex-file-path="${escapedPath}"]`
      );
      if (!targetFile) {
        if (attempt < maxAttempts) {
          requestAnimationFrame(() => focusFileAndLine(attempt + 1));
        }
        return;
      }

      targetFile.scrollIntoView({
        behavior: attempt === 0 ? "smooth" : "auto",
        block: "start",
        inline: "nearest",
      });

      if (!wantsLineFocus) return;

      const fileDiffContainer = targetFile.querySelector("diffs-container");
      const shadowRoot =
        fileDiffContainer instanceof HTMLElement ? fileDiffContainer.shadowRoot : null;
      const searchRoots: ParentNode[] = shadowRoot ? [shadowRoot, targetFile] : [targetFile];

      let lineTarget: HTMLElement | null = null;
      if (focusFindingId.length > 0) {
        const escapedFindingId = escapeSelectorValue(focusFindingId);
        for (const root of searchRoots) {
          lineTarget = root.querySelector<HTMLElement>(
            `[data-rovex-annotation-id="${escapedFindingId}"]`
          );
          if (lineTarget) break;
        }
      }
      if (!lineTarget && focusLineNumber != null) {
        const annotationLineSelector =
          focusLineSide != null
            ? `[data-rovex-line-side="${focusLineSide}"][data-rovex-line-number="${focusLineNumber}"]`
            : `[data-rovex-line-number="${focusLineNumber}"]`;
        for (const root of searchRoots) {
          lineTarget = root.querySelector<HTMLElement>(annotationLineSelector);
          if (lineTarget) break;
        }
      }

      if (!lineTarget && focusLineNumber != null) {
        const sideType =
          focusLineSide === "additions"
            ? "change-addition"
            : focusLineSide === "deletions"
              ? "change-deletion"
              : null;
        const rowSelector =
          sideType != null
            ? `[data-line="${focusLineNumber}"][data-line-type="${sideType}"]`
            : `[data-line="${focusLineNumber}"]`;
        for (const root of searchRoots) {
          lineTarget = root.querySelector<HTMLElement>(rowSelector);
          if (lineTarget) break;
        }
      }

      if (lineTarget) {
        lineTarget.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
        return;
      }

      if (!shadowRoot && attempt < maxAttempts) {
        requestAnimationFrame(() => focusFileAndLine(attempt + 1));
        return;
      }

      if (attempt < maxAttempts) {
        requestAnimationFrame(() => focusFileAndLine(attempt + 1));
      }
    };

    queueMicrotask(() => focusFileAndLine(0));
    onCleanup(() => {
      canceled = true;
    });
  });

  return (
    <div ref={viewerRootRef} class={themeClass()}>
      <Show when={parseError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300/90">
            Failed to render diff: {message()}
          </div>
        )}
      </Show>
      <Show when={!parseError() && props.patch.trim().length > 0 && files().length === 0}>
        <div class="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] text-neutral-400">
          Parsing diff...
        </div>
      </Show>
      <Show when={files().length > 0 && showToolbar()}>
        <div class="rovex-diff-viewer-header">
          <div class="flex items-center gap-2">
            <span class="rovex-diff-viewer-title">{filesLabel()}</span>
            <Show when={fastMode()}>
              <span class="rounded-md border border-amber-300/30 bg-amber-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.05em] text-amber-200/85">
                fast mode
              </span>
            </Show>
            <Show when={profileLabel()}>
              {(label) => (
                <span class="text-[11px] text-neutral-400" title="Set localStorage['rovex.profile.diff']='1' to enable profiling.">
                  {label()}
                </span>
              )}
            </Show>
            <Show when={lineNumbers()}>
              <span class="text-[11px] text-neutral-500/90">
                Click any diff line or drag line numbers to comment on ranges
              </span>
            </Show>
          </div>
          <div class="rovex-diff-icon-controls" role="toolbar" aria-label="Diff rendering options">
            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  class={`rovex-diff-icon-button ${lineWrap() ? "is-active" : ""}`}
                  aria-label="Toggle line wrap"
                  aria-pressed={lineWrap()}
                  onClick={() => setLineWrap((current) => !current)}
                >
                  <WrapText class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Line wrap</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  class={`rovex-diff-icon-button ${lineNumbers() ? "is-active" : ""}`}
                  aria-label="Toggle line numbers"
                  aria-pressed={lineNumbers()}
                  onClick={() => setLineNumbers((current) => !current)}
                >
                  <Hash class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Line numbers</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  class={`rovex-diff-icon-button ${unifiedStyle() ? "is-active" : ""}`}
                  aria-label={unifiedStyle() ? "Switch to split view" : "Switch to unified view"}
                  aria-pressed={unifiedStyle()}
                  onClick={() => setUnifiedStyle((current) => !current)}
                >
                  <Show when={unifiedStyle()} fallback={<Columns2 class="size-3.5" />}>
                    <Rows3 class="size-3.5" />
                  </Show>
                </button>
              </TooltipTrigger>
              <TooltipContent>{unifiedStyle() ? "Unified view" : "Split view"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  class={`rovex-diff-icon-button ${disableBackground() ? "is-active" : ""}`}
                  aria-label="Toggle diff background"
                  aria-pressed={disableBackground()}
                  onClick={() => setDisableBackground((current) => !current)}
                >
                  <PaintBucket class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Disable background</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Show>
      <div class="rovex-diff-viewer">
        <For each={files()}>
          {(file, index) => {
            const primaryPath = normalizeDiffPath(file.name);
            const previousPath = normalizeDiffPath(file.prevName);
            const fileAnnotations = createMemo<
              DiffLineAnnotation<DiffViewerAnnotationMetadata>[]
            >(() => {
              const annotationsMap = annotationsByFile();
              const primaryAnnotations =
                annotationsMap.get(primaryPath) ?? EMPTY_LINE_ANNOTATIONS;
              const previousAnnotations =
                annotationsMap.get(previousPath) ?? EMPTY_LINE_ANNOTATIONS;
              if (previousAnnotations.length === 0) return primaryAnnotations;
              if (primaryAnnotations.length === 0) return previousAnnotations;
              return [...primaryAnnotations, ...previousAnnotations];
            });
            const normalizedFilePath = primaryPath || previousPath;
            return (
              <DiffFileCard
                file={file}
                initiallyVisible={index() < initialVisibleCount()}
                initiallyCollapsed={
                  normalizedFilePath.length > 0 && collapsedFilePaths().has(normalizedFilePath)
                }
                fastMode={fastMode()}
                options={renderOptions()}
                lineAnnotations={fileAnnotations}
                onCollapsedChange={handleFileCollapsedChange}
                onAskAiAboutFile={props.onAskAiAboutFile}
                onOpenFile={props.onOpenFile}
                onLineClick={handleLineClick}
                onLineNumberClick={handleLineNumberClick}
                onLineSelectionChange={handleLineSelectionChange}
                pendingSelectionTarget={pendingSelectionTarget()}
                onAddCommentForSelection={handleAddCommentForSelection}
                onRendered={handleFileRendered}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
