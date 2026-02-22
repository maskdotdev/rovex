import { describe, expect, it } from "vitest";
import {
  collectMentionedDiffContexts,
  extractDiffFileMentions,
} from "@/app/hooks/review-actions/ai-review-actions";

const SAMPLE_DIFF = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-const one = 1;
+const one = 2;
diff --git a/src/two.ts b/src/two.ts
index 1111111..2222222 100644
--- a/src/two.ts
+++ b/src/two.ts
@@ -1 +1 @@
-const two = 1;
+const two = 2;
diff --git a/pkg/two.ts b/pkg/two.ts
index 1111111..2222222 100644
--- a/pkg/two.ts
+++ b/pkg/two.ts
@@ -1 +1 @@
-const pkgTwo = 1;
+const pkgTwo = 2;
diff --git a/src/three.ts b/src/three.ts
index 1111111..2222222 100644
--- a/src/three.ts
+++ b/src/three.ts
@@ -1 +1 @@
-const three = 1;
+const three = 2;
diff --git a/src/four.ts b/src/four.ts
index 1111111..2222222 100644
--- a/src/four.ts
+++ b/src/four.ts
@@ -1 +1 @@
-const four = 1;
+const four = 2;`;

describe("extractDiffFileMentions", () => {
  it("extracts normalized @file mentions and ignores inline email-style text", () => {
    const mentions = extractDiffFileMentions(
      "review foo@bar.com and @a/src/one.ts, then @pkg/two.ts. duplicate @pkg/two.ts"
    );
    expect(mentions).toEqual(["src/one.ts", "pkg/two.ts"]);
  });
});

describe("collectMentionedDiffContexts", () => {
  it("resolves exact and suffix mentions into contexts", () => {
    const result = collectMentionedDiffContexts(SAMPLE_DIFF, ["src/one.ts", "three.ts"]);
    expect(result.contexts.map((context) => context.filePath)).toEqual(["src/one.ts", "src/three.ts"]);
    expect(result.unresolvedMentions).toEqual([]);
    expect(result.ambiguousMentions).toEqual([]);
  });

  it("tracks unresolved and ambiguous mentions", () => {
    const result = collectMentionedDiffContexts(SAMPLE_DIFF, ["missing.ts", "two.ts"]);
    expect(result.contexts).toEqual([]);
    expect(result.unresolvedMentions).toEqual(["missing.ts"]);
    expect(result.ambiguousMentions).toEqual(["two.ts"]);
  });

  it("caps mentioned file attachments to three", () => {
    const result = collectMentionedDiffContexts(SAMPLE_DIFF, [
      "src/one.ts",
      "src/two.ts",
      "src/three.ts",
      "src/four.ts",
    ]);
    expect(result.contexts.map((context) => context.filePath)).toEqual([
      "src/one.ts",
      "src/two.ts",
      "src/three.ts",
    ]);
    expect(result.omittedPaths).toEqual(["src/four.ts"]);
  });
});
