import { createEffect, createResource, createSignal, type Accessor } from "solid-js";
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
  type ProviderKind,
} from "@/lib/backend";

type UsePrimaryResourcesArgs = {
  selectedProvider: Accessor<ProviderKind>;
};

export function usePrimaryResources(args: UsePrimaryResourcesArgs) {
  const [githubConnectionRequested, setGithubConnectionRequested] = createSignal(
    args.selectedProvider() === "github"
  );
  const [gitlabConnectionRequested, setGitlabConnectionRequested] = createSignal(
    args.selectedProvider() === "gitlab"
  );

  createEffect(() => {
    const provider = args.selectedProvider();
    if (provider === "github") {
      setGithubConnectionRequested(true);
      return;
    }
    setGitlabConnectionRequested(true);
  });

  const [threads, { refetch: refetchThreads }] = createResource(() => listThreads(200));
  const [githubConnection, { refetch: rawRefetchGithubConnection }] = createResource(
    githubConnectionRequested,
    async (requested: boolean): Promise<ProviderConnection | null> =>
      requested ? getProviderConnection("github") : null
  );
  const [gitlabConnection, { refetch: rawRefetchGitlabConnection }] = createResource(
    gitlabConnectionRequested,
    async (requested: boolean): Promise<ProviderConnection | null> =>
      requested ? getProviderConnection("gitlab") : null
  );
  const [aiReviewConfig, { refetch: refetchAiReviewConfig }] = createResource<AiReviewConfig>(
    () => getAiReviewConfig()
  );
  const [appServerAccountStatus, { refetch: refetchAppServerAccountStatus }] =
    createResource<AppServerAccountStatus>(() => getAppServerAccountStatus());
  const [opencodeSidecarStatus, { refetch: refetchOpencodeSidecarStatus }] =
    createResource<OpencodeSidecarStatus>(() => getOpencodeSidecarStatus());

  const refetchGithubConnection = () => {
    setGithubConnectionRequested(true);
    return rawRefetchGithubConnection();
  };

  const refetchGitlabConnection = () => {
    setGitlabConnectionRequested(true);
    return rawRefetchGitlabConnection();
  };

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
