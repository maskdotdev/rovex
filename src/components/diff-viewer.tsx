import { FileDiff, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

type DiffViewerProps = {
  patch: string;
};

type DiffFileCardProps = {
  file: FileDiffMetadata;
  index: number;
};

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

    container.replaceChildren();

    let instance: FileDiff | undefined;
    try {
      instance = new FileDiff({
        diffStyle: "split",
        hunkSeparators: "metadata",
        lineDiffType: "word",
        themeType: "dark",
        theme: { dark: "pierre-dark", light: "pierre-light" },
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

  return (
    <>
      <Show when={parseError()}>
        {(message) => (
          <div class="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300/90">
            Failed to render diff: {message()}
          </div>
        )}
      </Show>
      <div class="rovex-diff-viewer">
        <For each={files()}>
          {(file, index) => (
            <DiffFileCard file={file} index={index()} />
          )}
        </For>
      </div>
    </>
  );
}
