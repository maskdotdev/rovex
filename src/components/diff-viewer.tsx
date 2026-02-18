import {
  FileDiff,
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
} from "@pierre/diffs";
import { Columns2, Hash, PaintBucket, Rows3, WrapText } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
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

type DiffViewerAnnotationMetadata = {
  id: string;
  title: string;
  body: string;
  severity: string;
  chunkId?: string | null;
};

type DiffViewerProps = {
  patch: string;
  theme: DiffViewerTheme;
  themeId?: string;
  themeType?: "system" | "light" | "dark";
  showToolbar?: boolean;
  annotations?: DiffViewerAnnotation[];
};

type DiffFileCardProps = {
  file: FileDiffMetadata;
  index: number;
  options: DiffRenderOptions;
  lineAnnotations: DiffLineAnnotation<DiffViewerAnnotationMetadata>[];
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
>;

const diffStickyHeaderUnsafeCSS = `
[data-diffs-header] {
  position: sticky;
  top: 0;
  z-index: 5;
  border-bottom: 1px solid color-mix(in lab, var(--diffs-bg) 92%, var(--diffs-fg));
  background: color-mix(in lab, var(--diffs-bg) 94%, black);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
`;

function normalizeDiffPath(path: string | null | undefined) {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/^([ab])\//, "");
  return normalized;
}

function renderDiffAnnotation(annotation: DiffLineAnnotation<DiffViewerAnnotationMetadata>) {
  const metadata = annotation.metadata;
  if (!metadata) return undefined;

  const root = document.createElement("div");
  root.className = `rovex-inline-annotation is-${metadata.severity || "medium"}`;

  const titleRow = document.createElement("div");
  titleRow.className = "rovex-inline-annotation-title";
  titleRow.textContent = metadata.title;
  root.appendChild(titleRow);

  const body = document.createElement("p");
  body.className = "rovex-inline-annotation-body";
  body.textContent = metadata.body;
  root.appendChild(body);

  if (metadata.chunkId) {
    const footer = document.createElement("div");
    footer.className = "rovex-inline-annotation-footer";
    footer.textContent = metadata.chunkId;
    root.appendChild(footer);
  }

  return root;
}

function DiffFileCard(props: DiffFileCardProps) {
  let visibilityAnchorRef: HTMLDivElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  const [shouldRender, setShouldRender] = createSignal(props.index < 2);
  const [renderError, setRenderError] = createSignal<string | null>(null);

  createEffect(() => {
    const anchor = visibilityAnchorRef;
    if (!anchor || shouldRender()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(anchor);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (!shouldRender()) return;
    const container = containerRef;
    if (!container) return;
    const options = props.options;

    container.replaceChildren();

    let instance: FileDiff<DiffViewerAnnotationMetadata> | undefined;
    try {
      instance = new FileDiff({
        ...options,
        hunkSeparators: "metadata",
        lineDiffType: "word",
      });
      instance.render({
        fileDiff: props.file,
        containerWrapper: container,
        lineAnnotations: props.lineAnnotations,
      });
      setRenderError(null);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    }

    onCleanup(() => {
      instance?.cleanUp();
      container.replaceChildren();
    });
  });

  return (
    <section class="rovex-diff-file">
      <Show when={renderError()}>
        {(message) => (
          <div class="mx-3 mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300/90">
            Failed to render file diff: {message()}
          </div>
        )}
      </Show>
      <div ref={visibilityAnchorRef}>
        <Show
          when={shouldRender()}
          fallback={
            <div class="rovex-diff-file-placeholder">
              Scroll to render this file diff.
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
  const showToolbar = createMemo(() => props.showToolbar ?? true);
  const themeClass = createMemo(() =>
    props.themeId?.trim() ? `rovex-diff-theme-${props.themeId}` : ""
  );
  const [lineWrap, setLineWrap] = createSignal(false);
  const [lineNumbers, setLineNumbers] = createSignal(true);
  const [unifiedStyle, setUnifiedStyle] = createSignal(false);
  const [disableBackground, setDisableBackground] = createSignal(false);

  const renderOptions = createMemo<DiffRenderOptions>(() => ({
    overflow: lineWrap() ? "wrap" : "scroll",
    disableLineNumbers: !lineNumbers(),
    diffStyle: unifiedStyle() ? "unified" : "split",
    disableBackground: disableBackground(),
    theme: props.theme,
    themeType: props.themeType ?? "dark",
    unsafeCSS: diffStickyHeaderUnsafeCSS,
    renderAnnotation: renderDiffAnnotation,
  }));

  const parsedDiff = createMemo(() => {
    const patchText = props.patch.trim();
    if (patchText.length === 0) {
      return { files: [] as FileDiffMetadata[], parseError: null as string | null };
    }

    try {
      const parsedPatches = parsePatchFiles(patchText);
      const files: FileDiffMetadata[] = [];
      for (const patch of parsedPatches) {
        files.push(...patch.files);
      }
      return { files, parseError: null as string | null };
    } catch (error) {
      return {
        files: [] as FileDiffMetadata[],
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const parseError = createMemo(() => parsedDiff().parseError);
  const files = createMemo(() => parsedDiff().files);
  const annotationsByFile = createMemo(() => {
    const map = new Map<string, DiffLineAnnotation<DiffViewerAnnotationMetadata>[]>();
    for (const annotation of props.annotations ?? []) {
      const normalizedPath = normalizeDiffPath(annotation.filePath);
      if (!normalizedPath) continue;
      const side = annotation.side === "deletions" ? "deletions" : "additions";
      const lineNumber = Number(annotation.lineNumber);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      const entry: DiffLineAnnotation<DiffViewerAnnotationMetadata> = {
        side,
        lineNumber,
        metadata: {
          id: annotation.id,
          title: annotation.title,
          body: annotation.body,
          severity: annotation.severity || "medium",
          chunkId: annotation.chunkId,
        },
      };
      const existing = map.get(normalizedPath) ?? [];
      existing.push(entry);
      map.set(normalizedPath, existing);
    }
    return map;
  });
  const filesLabel = createMemo(() => {
    const count = files().length;
    return `${count} file${count === 1 ? "" : "s"}`;
  });

  return (
    <div class={themeClass()}>
      <Show when={parseError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300/90">
            Failed to render diff: {message()}
          </div>
        )}
      </Show>
      <Show when={files().length > 0 && showToolbar()}>
        <div class="rovex-diff-viewer-header">
          <span class="rovex-diff-viewer-title">{filesLabel()}</span>
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
              <TooltipContent>{unifiedStyle() ? "Split view" : "Unified view"}</TooltipContent>
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
            const fileAnnotations = [
              ...(annotationsByFile().get(primaryPath) ?? []),
              ...(annotationsByFile().get(previousPath) ?? []),
            ];
            return (
              <DiffFileCard
                file={file}
                index={index()}
                options={renderOptions()}
                lineAnnotations={fileAnnotations}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
