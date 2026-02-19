import { createMemo, createSignal, type Accessor } from "solid-js";
import {
  getInitialKnownRepoWorkspaces,
  getInitialRepoDisplayNames,
  getInitialRepoReviewDefaults,
  groupThreadsByRepo,
} from "@/app/helpers";
import type { RepoReview, RepoReviewDefaults } from "@/app/types";
import type { Thread } from "@/lib/backend";

type UseRepoStateArgs = {
  threads: Accessor<Thread[] | undefined>;
};

export function useRepoState(args: UseRepoStateArgs) {
  const [knownRepoWorkspaces, setKnownRepoWorkspaces] = createSignal<Record<string, string>>(
    getInitialKnownRepoWorkspaces()
  );
  const repoGroups = createMemo(() =>
    groupThreadsByRepo(args.threads() ?? [], knownRepoWorkspaces())
  );
  const [collapsedRepos, setCollapsedRepos] = createSignal<Record<string, boolean>>({});
  const [repoDisplayNames, setRepoDisplayNames] = createSignal<Record<string, string>>(
    getInitialRepoDisplayNames()
  );
  const [reviewDefaultsByRepo, setReviewDefaultsByRepo] = createSignal<
    Record<string, RepoReviewDefaults>
  >(getInitialRepoReviewDefaults());
  const [repoMenuOpen, setRepoMenuOpen] = createSignal<Record<string, boolean>>({});
  const [selectedThreadId, setSelectedThreadId] = createSignal<number | null>(null);

  const selectedReview = createMemo<RepoReview | undefined>(() => {
    const selected = selectedThreadId();
    if (selected == null) return undefined;

    for (const group of repoGroups()) {
      const review = group.reviews.find((candidate) => candidate.id === selected);
      if (review) return review;
    }

    return undefined;
  });

  return {
    knownRepoWorkspaces,
    setKnownRepoWorkspaces,
    repoGroups,
    collapsedRepos,
    setCollapsedRepos,
    repoDisplayNames,
    setRepoDisplayNames,
    reviewDefaultsByRepo,
    setReviewDefaultsByRepo,
    repoMenuOpen,
    setRepoMenuOpen,
    selectedThreadId,
    setSelectedThreadId,
    selectedReview,
  };
}
