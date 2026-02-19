import { createResource } from "solid-js";
import {
  getAiReviewConfig,
  getAppServerAccountStatus,
  getOpencodeSidecarStatus,
  getProviderConnection,
  listThreads,
  type AiReviewConfig,
  type AppServerAccountStatus,
  type OpencodeSidecarStatus,
  type ProviderConnection,
} from "@/lib/backend";

export function usePrimaryResources() {
  const [threads, { refetch: refetchThreads }] = createResource(() => listThreads(200));
  const [githubConnection, { refetch: refetchGithubConnection }] = createResource<
    ProviderConnection | null
  >(() => getProviderConnection("github"));
  const [gitlabConnection, { refetch: refetchGitlabConnection }] = createResource<
    ProviderConnection | null
  >(() => getProviderConnection("gitlab"));
  const [aiReviewConfig, { refetch: refetchAiReviewConfig }] = createResource<AiReviewConfig>(
    () => getAiReviewConfig()
  );
  const [appServerAccountStatus, { refetch: refetchAppServerAccountStatus }] =
    createResource<AppServerAccountStatus>(() => getAppServerAccountStatus());
  const [opencodeSidecarStatus, { refetch: refetchOpencodeSidecarStatus }] =
    createResource<OpencodeSidecarStatus>(() => getOpencodeSidecarStatus());

  return {
    threads,
    refetchThreads,
    githubConnection,
    refetchGithubConnection,
    gitlabConnection,
    refetchGitlabConnection,
    aiReviewConfig,
    refetchAiReviewConfig,
    appServerAccountStatus,
    refetchAppServerAccountStatus,
    opencodeSidecarStatus,
    refetchOpencodeSidecarStatus,
  };
}
