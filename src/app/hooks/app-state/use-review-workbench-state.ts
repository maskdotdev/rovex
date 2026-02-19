import { createSignal } from "solid-js";
import { createFullReviewScope } from "@/app/review-scope";
import type { ReviewRun, ReviewWorkbenchTab } from "@/app/review-types";

export function useReviewWorkbenchState() {
  const [activeReviewScope, setActiveReviewScope] = createSignal(createFullReviewScope());
  const [reviewRuns, setReviewRuns] = createSignal<ReviewRun[]>([]);
  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
  const [reviewWorkbenchTab, setReviewWorkbenchTab] =
    createSignal<ReviewWorkbenchTab>("description");

  return {
    activeReviewScope,
    setActiveReviewScope,
    reviewRuns,
    setReviewRuns,
    selectedRunId,
    setSelectedRunId,
    reviewWorkbenchTab,
    setReviewWorkbenchTab,
  };
}
