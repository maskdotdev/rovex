/// <reference lib="webworker" />

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

type ParsePatchWorkerRequest = {
  patch: string;
};

type ParsePatchWorkerResponse =
  | { ok: true; files: FileDiffMetadata[]; parseMs: number }
  | { ok: false; error: string; parseMs: number };

self.onmessage = (event: MessageEvent<ParsePatchWorkerRequest>) => {
  const patchText = event.data.patch?.trim() ?? "";
  const parseStartedAt = performance.now();

  try {
    const parsedPatches = parsePatchFiles(patchText);
    const files: FileDiffMetadata[] = [];
    for (const patch of parsedPatches) {
      files.push(...patch.files);
    }
    const response: ParsePatchWorkerResponse = {
      ok: true,
      files,
      parseMs: performance.now() - parseStartedAt,
    };
    self.postMessage(response);
  } catch (error) {
    const response: ParsePatchWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      parseMs: performance.now() - parseStartedAt,
    };
    self.postMessage(response);
  }
};

