import { FileDiff, parsePatchFiles } from "@pierre/diffs";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

type DiffViewerProps = {
  patch: string;
};

export function DiffViewer(props: DiffViewerProps) {
  let containerRef: HTMLDivElement | undefined;
  const [parseError, setParseError] = createSignal<string | null>(null);

  createEffect(() => {
    const host = containerRef;
    if (!host) return;

    host.replaceChildren();

    const patchText = props.patch.trim();
    if (patchText.length === 0) {
      setParseError(null);
      return;
    }

    let parsedPatches;
    try {
      parsedPatches = parsePatchFiles(patchText);
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
      return;
    }

    const instances: FileDiff[] = [];
    for (const patch of parsedPatches) {
      for (const file of patch.files) {
        const wrapper = document.createElement("section");
        wrapper.className = "rovex-diff-file";
        host.append(wrapper);

        const instance = new FileDiff({
          diffStyle: "split",
          hunkSeparators: "metadata",
          lineDiffType: "word",
          themeType: "dark",
          theme: { dark: "pierre-dark", light: "pierre-light" },
        });
        instance.render({ fileDiff: file, containerWrapper: wrapper });
        instances.push(instance);
      }
    }

    onCleanup(() => {
      for (const instance of instances) {
        instance.cleanUp();
      }
      host.replaceChildren();
    });
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
      <div ref={containerRef} class="rovex-diff-viewer" />
    </>
  );
}
