export type ReviewScope =
  | { kind: "full" }
  | { kind: "file"; filePath: string }
  | { kind: "hunk"; filePath: string; hunkIndex: number };

export type ParsedDiffHunk = {
  hunkIndex: number;
  header: string;
  lines: string[];
};

export type ParsedDiffFile = {
  filePath: string;
  lines: string[];
  headerLines: string[];
  hunks: ParsedDiffHunk[];
};

export type ScopedDiffResult = {
  diff: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

const DIFF_START_PREFIX = "diff --git ";
const HUNK_HEADER_PREFIX = "@@ ";

export function createFullReviewScope(): ReviewScope {
  return { kind: "full" };
}

export function normalizeDiffPath(path: string | null | undefined) {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^([ab])\//, "");
}

export function getReviewScopeLabel(scope: ReviewScope): string {
  if (scope.kind === "full") return "Full diff";
  if (scope.kind === "file") return scope.filePath;
  return `${scope.filePath} · hunk ${scope.hunkIndex}`;
}

export function getReviewScopeContext(scope: ReviewScope): string {
  if (scope.kind === "full") return "scope=full-diff";
  if (scope.kind === "file") return `scope=file path=${scope.filePath}`;
  return `scope=hunk path=${scope.filePath} hunk=${scope.hunkIndex}`;
}

export function parsePatchFiles(patch: string): ParsedDiffFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const sections: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith(DIFF_START_PREFIX)) {
      if (current && current.length > 0) sections.push(current);
      current = [line];
      continue;
    }
    if (current) {
      current.push(line);
    }
  }

  if (current && current.length > 0) {
    sections.push(current);
  }

  return sections.map((section) => {
    const plusLine = section.find((line) => line.startsWith("+++ "));
    const minusLine = section.find((line) => line.startsWith("--- "));

    const plusPath = normalizeDiffPath(plusLine?.slice(4));
    const minusPath = normalizeDiffPath(minusLine?.slice(4));
    const filePath = plusPath && plusPath !== "/dev/null" ? plusPath : minusPath;

    const hunkStarts: number[] = [];
    for (let index = 0; index < section.length; index += 1) {
      if (section[index]?.startsWith(HUNK_HEADER_PREFIX)) {
        hunkStarts.push(index);
      }
    }

    const headerEnd = hunkStarts[0] ?? section.length;
    const headerLines = section.slice(0, headerEnd);

    const hunks: ParsedDiffHunk[] = hunkStarts.map((start, index) => {
      const end = hunkStarts[index + 1] ?? section.length;
      return {
        hunkIndex: index + 1,
        header: section[start] ?? `hunk ${index + 1}`,
        lines: section.slice(start, end),
      };
    });

    return {
      filePath,
      lines: section,
      headerLines,
      hunks,
    };
  });
}

export function scopeExistsInPatch(scope: ReviewScope, patch: string): boolean {
  if (scope.kind === "full") return true;
  const files = parsePatchFiles(patch);
  const file = files.find((candidate) => normalizeDiffPath(candidate.filePath) === normalizeDiffPath(scope.filePath));
  if (!file) return false;
  if (scope.kind === "file") return true;
  return file.hunks.some((hunk) => hunk.hunkIndex === scope.hunkIndex);
}

export function buildScopedDiff(patch: string, scope: ReviewScope): ScopedDiffResult | null {
  if (scope.kind === "full") {
    const normalized = patch.trim();
    if (!normalized) return null;
    return {
      diff: normalized,
      ...summarizePatchStats(normalized),
    };
  }

  const files = parsePatchFiles(patch);
  const file = files.find((candidate) => normalizeDiffPath(candidate.filePath) === normalizeDiffPath(scope.filePath));
  if (!file) return null;

  let selectedLines: string[] = [];
  if (scope.kind === "file") {
    selectedLines = file.lines;
  } else {
    const hunk = file.hunks.find((candidate) => candidate.hunkIndex === scope.hunkIndex);
    if (!hunk) return null;
    selectedLines = [...file.headerLines, ...hunk.lines];
  }

  const scopedPatch = selectedLines.join("\n").trim();
  if (!scopedPatch) return null;

  return {
    diff: scopedPatch,
    ...summarizePatchStats(scopedPatch),
  };
}

function summarizePatchStats(patch: string) {
  const lines = patch.split("\n");
  const filesChanged = lines.filter((line) => line.startsWith(DIFF_START_PREFIX)).length;
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) insertions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return {
    filesChanged,
    insertions,
    deletions,
  };
}
