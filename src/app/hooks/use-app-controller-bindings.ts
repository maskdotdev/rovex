import type { useAppEffects } from "@/app/hooks/use-app-effects";
import type { useAppState } from "@/app/hooks/use-app-state";
import type { useProviderAndSettingsActions } from "@/app/hooks/use-provider-and-settings-actions";
import type { useReviewActions } from "@/app/hooks/use-review-actions";

type AppState = ReturnType<typeof useAppState>;

export function buildProviderAndSettingsActionArgs(
  s: AppState
): Parameters<typeof useProviderAndSettingsActions>[0] {
  return {
    providerState: {
      selectedProvider: s.selectedProvider,
      setSelectedProvider: s.setSelectedProvider,
      providerToken: s.providerToken,
      setProviderToken: s.setProviderToken,
      repositoryInput: s.repositoryInput,
      setRepositoryInput: s.setRepositoryInput,
      destinationRoot: s.destinationRoot,
      setDestinationRoot: s.setDestinationRoot,
      localProjectPath: s.localProjectPath,
      setLocalProjectPath: s.setLocalProjectPath,
      providerBusy: s.providerBusy,
      setProviderBusy: s.setProviderBusy,
      providerError: s.providerError,
      setProviderError: s.setProviderError,
      providerStatus: s.providerStatus,
      setProviderStatus: s.setProviderStatus,
      deviceAuthInProgress: s.deviceAuthInProgress,
      setDeviceAuthInProgress: s.setDeviceAuthInProgress,
      deviceAuthUserCode: s.deviceAuthUserCode,
      setDeviceAuthUserCode: s.setDeviceAuthUserCode,
      deviceAuthVerificationUrl: s.deviceAuthVerificationUrl,
      setDeviceAuthVerificationUrl: s.setDeviceAuthVerificationUrl,
    },
    navigation: {
      setActiveView: s.setActiveView,
      setActiveSettingsTab: s.setActiveSettingsTab,
    },
    connectionRefetch: {
      refetchGithubConnection: s.refetchGithubConnection,
      refetchGitlabConnection: s.refetchGitlabConnection,
    },
    repoState: {
      refetchThreads: s.refetchThreads,
      setSelectedThreadId: s.setSelectedThreadId,
      selectedBaseRef: s.selectedBaseRef,
      setSelectedBaseRef: s.setSelectedBaseRef,
      reviewDefaultsByRepo: s.reviewDefaultsByRepo,
      setReviewDefaultsByRepo: s.setReviewDefaultsByRepo,
      knownRepoWorkspaces: s.knownRepoWorkspaces,
      setKnownRepoWorkspaces: s.setKnownRepoWorkspaces,
      repoDisplayNames: s.repoDisplayNames,
      setRepoDisplayNames: s.setRepoDisplayNames,
      collapsedRepos: s.collapsedRepos,
      setCollapsedRepos: s.setCollapsedRepos,
      repoMenuOpen: s.repoMenuOpen,
      setRepoMenuOpen: s.setRepoMenuOpen,
    },
    settingsState: {
      setSettingsError: s.setSettingsError,
    },
    aiSettingsState: {
      aiReviewProviderInput: s.aiReviewProviderInput,
      aiReviewModelInput: s.aiReviewModelInput,
      aiOpencodeProviderInput: s.aiOpencodeProviderInput,
      aiOpencodeModelInput: s.aiOpencodeModelInput,
      aiSettingsBusy: s.aiSettingsBusy,
      setAiSettingsBusy: s.setAiSettingsBusy,
      setAiSettingsError: s.setAiSettingsError,
      setAiSettingsStatus: s.setAiSettingsStatus,
      refetchAiReviewConfig: s.refetchAiReviewConfig,
    },
    accountState: {
      appServerAuthBusy: s.appServerAuthBusy,
      setAppServerAuthBusy: s.setAppServerAuthBusy,
      setAppServerAuthError: s.setAppServerAuthError,
      setAppServerAuthStatus: s.setAppServerAuthStatus,
      refetchAppServerAccountStatus: s.refetchAppServerAccountStatus,
      refetchOpencodeSidecarStatus: s.refetchOpencodeSidecarStatus,
    },
    apiKeyState: {
      aiApiKeyInput: s.aiApiKeyInput,
      setAiApiKeyInput: s.setAiApiKeyInput,
      aiApiKeyBusy: s.aiApiKeyBusy,
      setAiApiKeyBusy: s.setAiApiKeyBusy,
      setAiApiKeyError: s.setAiApiKeyError,
      setAiApiKeyStatus: s.setAiApiKeyStatus,
    },
  };
}

export function buildReviewActionArgs(s: AppState): Parameters<typeof useReviewActions>[0] {
  return {
    selection: {
      selectedThreadId: s.selectedThreadId,
      selectedWorkspace: s.selectedWorkspace,
      selectedBaseRef: s.selectedBaseRef,
      setSelectedBaseRef: s.setSelectedBaseRef,
    },
    compare: {
      compareResult: s.compareResult,
      setCompareResult: s.setCompareResult,
      setCompareBusy: s.setCompareBusy,
      setCompareError: s.setCompareError,
      setShowDiffViewer: s.setShowDiffViewer,
    },
    branch: {
      setBranchPopoverOpen: s.setBranchPopoverOpen,
      setBranchCreateMode: s.setBranchCreateMode,
      branchSearchQuery: s.branchSearchQuery,
      newBranchName: s.newBranchName,
      setNewBranchName: s.setNewBranchName,
      setBranchActionBusy: s.setBranchActionBusy,
      setBranchActionError: s.setBranchActionError,
      refetchWorkspaceBranches: s.refetchWorkspaceBranches,
    },
    ai: {
      prompt: s.aiPrompt,
      setPrompt: s.setAiPrompt,
      setAiReviewBusy: s.setAiReviewBusy,
      setAiFollowUpBusy: s.setAiFollowUpBusy,
      setAiReviewError: s.setAiReviewError,
      setAiStatus: s.setAiStatus,
      setAiChunkReviews: s.setAiChunkReviews,
      setAiFindings: s.setAiFindings,
      setAiProgressEvents: s.setAiProgressEvents,
      refetchThreadMessages: s.refetchThreadMessages,
      refetchAiReviewRuns: s.refetchAiReviewRuns,
    },
    review: {
      activeReviewScope: s.activeReviewScope,
      setActiveReviewScope: s.setActiveReviewScope,
      setReviewRuns: s.setReviewRuns,
      setSelectedRunId: s.setSelectedRunId,
      setReviewWorkbenchTab: s.setReviewWorkbenchTab,
    },
  };
}

type ReviewActionsForEffects = Pick<ReturnType<typeof useReviewActions>, "handleCompareSelectedReview">;

export function buildAppEffectsArgs(
  s: AppState,
  reviewActions: ReviewActionsForEffects
): Parameters<typeof useAppEffects>[0] {
  return {
    selectedDiffTheme: s.selectedDiffTheme,
    knownRepoWorkspaces: s.knownRepoWorkspaces,
    setKnownRepoWorkspaces: s.setKnownRepoWorkspaces,
    repoDisplayNames: s.repoDisplayNames,
    repoGroups: s.repoGroups,
    selectedThreadId: s.selectedThreadId,
    setSelectedThreadId: s.setSelectedThreadId,
    setCompareError: s.setCompareError,
    setCompareResult: s.setCompareResult,
    setShowDiffViewer: s.setShowDiffViewer,
    setBranchPopoverOpen: s.setBranchPopoverOpen,
    setBranchSearchQuery: s.setBranchSearchQuery,
    setBranchCreateMode: s.setBranchCreateMode,
    setNewBranchName: s.setNewBranchName,
    setBranchActionError: s.setBranchActionError,
    setAiPrompt: s.setAiPrompt,
    setAiFollowUpBusy: s.setAiFollowUpBusy,
    setAiReviewError: s.setAiReviewError,
    setAiStatus: s.setAiStatus,
    setAiChunkReviews: s.setAiChunkReviews,
    setAiFindings: s.setAiFindings,
    setAiProgressEvents: s.setAiProgressEvents,
    branchPopoverOpen: s.branchPopoverOpen,
    selectedWorkspace: s.selectedWorkspace,
    refetchWorkspaceBranches: s.refetchWorkspaceBranches,
    getBranchSearchInputRef: s.getBranchSearchInputRef,
    branchCreateMode: s.branchCreateMode,
    getBranchCreateInputRef: s.getBranchCreateInputRef,
    aiReviewConfig: s.aiReviewConfig,
    setAiReviewProviderInput: s.setAiReviewProviderInput,
    setAiReviewModelInput: s.setAiReviewModelInput,
    setAiOpencodeProviderInput: s.setAiOpencodeProviderInput,
    setAiOpencodeModelInput: s.setAiOpencodeModelInput,
    setAiReviewBusy: s.setAiReviewBusy,
    persistedReviewRuns: s.persistedReviewRuns,
    refetchThreadMessages: s.refetchThreadMessages,
    refetchAiReviewRuns: s.refetchAiReviewRuns,
    aiReviewBusy: s.aiReviewBusy,
    setAiRunElapsedSeconds: s.setAiRunElapsedSeconds,
    setActiveReviewScope: s.setActiveReviewScope,
    setReviewRuns: s.setReviewRuns,
    selectedRunId: s.selectedRunId,
    setSelectedRunId: s.setSelectedRunId,
    setReviewWorkbenchTab: s.setReviewWorkbenchTab,
    maskAccountEmail: s.maskAccountEmail,
    reviewSidebarCollapsed: s.reviewSidebarCollapsed,
    setReviewSidebarCollapsed: s.setReviewSidebarCollapsed,
    reviewDefaultsByRepo: s.reviewDefaultsByRepo,
    handleCompareSelectedReview: reviewActions.handleCompareSelectedReview,
  };
}
