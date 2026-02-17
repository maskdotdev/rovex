import {
  FileDiff,
  parsePatchFiles,
  type FileDiffMetadata,
  type FileDiffOptions,
} from "@pierre/diffs";
import { Columns2, Hash, PaintBucket, Rows3, WrapText } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip";

export type DiffViewerTheme = {
  dark: string;
  light: string;
};

type DiffViewerProps = {
  patch: string;
  theme: DiffViewerTheme;
  themeType?: "system" | "light" | "dark";
  showToolbar?: boolean;
};

type DiffFileCardProps = {
  file: FileDiffMetadata;
  index: number;
  options: DiffRenderOptions;
};

type DiffRenderOptions = Pick<
  FileDiffOptions<undefined>,
  | "diffStyle"
  | "disableLineNumbers"
  | "disableBackground"
  | "overflow"
  | "theme"
  | "themeType"
>;

function DiffFileCard(props: DiffFileCardProps) {
  let visibilityAnchorRef: HTMLDivElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  const [shouldRender, setShouldRender] = createSignal(props.index < 2);
  const [renderError, setRenderError] = createSignal<string | null>(null);

  const fileLabel = createMemo(() => {
    const name = props.file.name.trim();
    const prevName = props.file.prevName?.trim();
    if (prevName && prevName !== name) return `${prevName} -> ${name}`;
    return name;
  });

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

    let instance: FileDiff | undefined;
    try {
      instance = new FileDiff({
        ...options,
        hunkSeparators: "metadata",
        lineDiffType: "word",
      });
      instance.render({ fileDiff: props.file, containerWrapper: container });
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
      <div class="rovex-diff-file-meta">
        <span class="rovex-diff-file-path">{fileLabel()}</span>
        <span class="rovex-diff-file-type">{props.file.type}</span>
      </div>
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
  const filesLabel = createMemo(() => {
    const count = files().length;
    return `${count} file${count === 1 ? "" : "s"}`;
  });

  return (
    <>
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
          {(file, index) => (
            <DiffFileCard file={file} index={index()} options={renderOptions()} />
          )}
        </For>
      </div>
    </>
  );
}
