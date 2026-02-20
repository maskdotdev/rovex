import type { SettingsViewModel } from "@/app/components/settings-view";
import type { WorkspaceViewModel } from "@/app/components/workspace-view";
import type { useAppState } from "@/app/hooks/use-app-state";
import type { useProviderAndSettingsActions } from "@/app/hooks/use-provider-and-settings-actions";
import type { useReviewActions } from "@/app/hooks/use-review-actions";

type AppState = ReturnType<typeof useAppState>;
type ProviderActions = ReturnType<typeof useProviderAndSettingsActions>;
type ReviewActions = ReturnType<typeof useReviewActions>;

type BuildAppViewModelsArgs = {
  state: AppState;
  providerActions: ProviderActions;
  reviewActions: Pick<
    ReviewActions,
    | "handleCheckoutBranch"
    | "handleStartCreateBranch"
    | "handleCreateAndCheckoutBranch"
    | "handleStartAiReviewOnFullDiff"
    | "handleCancelAiReviewRun"
    | "handlePrepareAiFollowUpForFile"
    | "handleAskAiFollowUp"
  >;
};

function buildSettingsViewModel(s: AppState, p: ProviderActions): SettingsViewModel {
  return {
    activeSettingsTab: s.activeSettingsTab,
    setActiveSettingsTab: s.setActiveSettingsTab,
    closeSettings: p.closeSettings,
    selectedDiffThemeId: s.selectedDiffThemeId,
    setSelectedDiffThemeId: s.setSelectedDiffThemeId,
    selectedDiffTheme: s.selectedDiffTheme,
    settingsError: s.settingsError,
    handleOpenDiffsDocs: p.handleOpenDiffsDocs,
    selectedProvider: s.selectedProvider,
    setSelectedProvider: s.setSelectedProvider,
    selectedProviderOption: s.selectedProviderOption,
    selectedProviderConnection: s.selectedProviderConnection,
    providerBusy: s.providerBusy,
    providerToken: s.providerToken,
    setProviderToken: s.setProviderToken,
    providerConnectionError: s.providerConnectionError,
    providerError: s.providerError,
    providerStatus: s.providerStatus,
    deviceAuthInProgress: s.deviceAuthInProgress,
    deviceAuthUserCode: s.deviceAuthUserCode,
    openDeviceVerificationUrl: p.openDeviceVerificationUrl,
    handleStartDeviceAuth: p.handleStartDeviceAuth,
    handleConnectProvider: p.handleConnectProvider,
    handleDisconnectProvider: p.handleDisconnectProvider,
    handleCloneRepository: p.handleCloneRepository,
    repositoryInput: s.repositoryInput,
    setRepositoryInput: s.setRepositoryInput,
    destinationRoot: s.destinationRoot,
    setDestinationRoot: s.setDestinationRoot,
    localProjectPath: s.localProjectPath,
    setLocalProjectPath: s.setLocalProjectPath,
    handlePickDestinationRoot: p.handlePickDestinationRoot,
    handlePickLocalProject: p.handlePickLocalProject,
    handleCreateLocalProjectThread: p.handleCreateLocalProjectThread,
    aiReviewConfig: s.aiReviewConfig,
    aiReviewProviderInput: s.aiReviewProviderInput,
    setAiReviewProviderInput: s.setAiReviewProviderInput,
    aiReviewModelInput: s.aiReviewModelInput,
    setAiReviewModelInput: s.setAiReviewModelInput,
    aiOpencodeProviderInput: s.aiOpencodeProviderInput,
    setAiOpencodeProviderInput: s.setAiOpencodeProviderInput,
    aiOpencodeModelInput: s.aiOpencodeModelInput,
    setAiOpencodeModelInput: s.setAiOpencodeModelInput,
    aiSettingsBusy: s.aiSettingsBusy,
    aiSettingsError: s.aiSettingsError,
    aiSettingsStatus: s.aiSettingsStatus,
    aiReviewConfigLoadError: s.aiReviewConfigLoadError,
    handleSaveAiSettings: p.handleSaveAiSettings,
    appServerAccountStatus: s.appServerAccountStatus,
    appServerAccountLoadError: s.appServerAccountLoadError,
    appServerAuthBusy: s.appServerAuthBusy,
    appServerAuthError: s.appServerAuthError,
    appServerAuthStatus: s.appServerAuthStatus,
    handleSwitchAppServerAccount: p.handleSwitchAppServerAccount,
    handleRefreshAppServerAccountStatus: p.handleRefreshAppServerAccountStatus,
    maskAccountEmail: s.maskAccountEmail,
    setMaskAccountEmail: s.setMaskAccountEmail,
    opencodeSidecarStatus: s.opencodeSidecarStatus,
    opencodeSidecarLoadError: s.opencodeSidecarLoadError,
    aiApiKeyInput: s.aiApiKeyInput,
    setAiApiKeyInput: s.setAiApiKeyInput,
    aiApiKeyBusy: s.aiApiKeyBusy,
    aiApiKeyError: s.aiApiKeyError,
    aiApiKeyStatus: s.aiApiKeyStatus,
    handleSaveAiApiKey: p.handleSaveAiApiKey,
  };
}

function buildWorkspaceRepoSidebarModel(
  s: AppState,
  p: ProviderActions,
): WorkspaceViewModel["repoSidebar"] {
  return {
    providerBusy: s.providerBusy,
    aiReviewBusy: s.aiReviewBusy,
    onAddLocalRepo: p.handleAddLocalRepoFromSidebar,
    threadsLoading: () => s.threads.loading,
    repoGroups: s.repoGroups,
    loadError: s.loadError,
    repoDisplayName: p.repoDisplayName,
    isRepoCollapsed: p.isRepoCollapsed,
    toggleRepoCollapsed: p.toggleRepoCollapsed,
    selectedThreadId: s.selectedThreadId,
    onSelectThread: s.setSelectedThreadId,
    onCreateReviewForRepo: p.handleCreateReviewForRepo,
    selectedBaseRef: s.selectedBaseRef,
    reviewDefaultsByRepo: s.reviewDefaultsByRepo,
    isRepoMenuOpen: p.isRepoMenuOpen,
    setRepoMenuOpenState: p.setRepoMenuOpenState,
    onRenameRepo: p.handleRenameRepo,
    onRemoveRepo: p.handleRemoveRepo,
    onRemoveReview: p.handleRemoveReview,
    onOpenSettings: () => p.openSettings("connections"),
    onSwitchAccount: p.handleSwitchAppServerAccount,
    appServerAccountStatus: s.appServerAccountStatus,
    appServerAccountLoadError: s.appServerAccountLoadError,
    maskAccountEmail: s.maskAccountEmail,
  };
}

function buildWorkspaceHeaderModel(s: AppState, p: ProviderActions): WorkspaceViewModel["header"] {
  return {
    selectedReview: s.selectedReview,
    repoDisplayName: p.repoDisplayName,
    compareResult: s.compareResult,
    selectedBaseRef: s.selectedBaseRef,
    reviewSidebarCollapsed: s.reviewSidebarCollapsed,
    toggleReviewSidebar: () => s.setReviewSidebarCollapsed((collapsed) => !collapsed),
  };
}

function buildWorkspaceMainPaneModel(
  s: AppState,
  r: BuildAppViewModelsArgs["reviewActions"]
): WorkspaceViewModel["mainPane"] {
  return {
    branchActionError: s.branchActionError,
    compareError: s.compareError,
    aiReviewError: s.aiReviewError,
    aiStatus: s.aiStatus,
    aiReviewBusy: s.aiReviewBusy,
    aiRunElapsedSeconds: s.aiRunElapsedSeconds,
    compareSummary: s.compareSummary,
    compareBusy: s.compareBusy,
    selectedWorkspace: s.selectedWorkspace,
    compareResult: s.compareResult,
    showDiffViewer: s.showDiffViewer,
    setShowDiffViewer: s.setShowDiffViewer,
    activeReviewScope: s.activeReviewScope,
    setActiveReviewScope: s.setActiveReviewScope,
    selectedDiffTheme: s.selectedDiffTheme,
    diffAnnotations: s.diffAnnotations,
    handlePrepareAiFollowUpForFile: r.handlePrepareAiFollowUpForFile,
    handleStartAiReviewOnFullDiff: r.handleStartAiReviewOnFullDiff,
  };
}

function buildWorkspaceReviewSidebarModel(
  s: AppState,
  r: BuildAppViewModelsArgs["reviewActions"]
): WorkspaceViewModel["reviewSidebar"] {
  return {
    reviewSidebarCollapsed: s.reviewSidebarCollapsed,
    activeReviewScope: s.activeReviewScope,
    setActiveReviewScope: s.setActiveReviewScope,
    aiChunkReviews: s.aiChunkReviews,
    aiFindings: s.aiFindings,
    aiProgressEvents: s.aiProgressEvents,
    reviewRuns: s.reviewRuns,
    selectedRunId: s.selectedRunId,
    setSelectedRunId: s.setSelectedRunId,
    reviewWorkbenchTab: s.reviewWorkbenchTab,
    setReviewWorkbenchTab: s.setReviewWorkbenchTab,
    threadMessagesLoadError: s.threadMessagesLoadError,
    threadMessages: s.threadMessages,
    aiPrompt: s.aiPrompt,
    setAiPrompt: s.setAiPrompt,
    aiSharedDiffContext: s.aiSharedDiffContext,
    setAiSharedDiffContext: s.setAiSharedDiffContext,
    handleAskAiFollowUp: r.handleAskAiFollowUp,
    handleCancelAiReviewRun: r.handleCancelAiReviewRun,
    aiReviewBusy: s.aiReviewBusy,
    aiFollowUpBusy: s.aiFollowUpBusy,
    compareBusy: s.compareBusy,
    selectedWorkspace: s.selectedWorkspace,
    branchPopoverOpen: s.branchPopoverOpen,
    setBranchPopoverOpen: s.setBranchPopoverOpen,
    workspaceBranches: s.workspaceBranches,
    workspaceBranchesLoading: () => s.workspaceBranches.loading,
    currentWorkspaceBranch: s.currentWorkspaceBranch,
    branchSearchQuery: s.branchSearchQuery,
    setBranchSearchQuery: s.setBranchSearchQuery,
    filteredWorkspaceBranches: s.filteredWorkspaceBranches,
    branchActionBusy: s.branchActionBusy,
    handleCheckoutBranch: r.handleCheckoutBranch,
    workspaceBranchLoadError: s.workspaceBranchLoadError,
    branchCreateMode: s.branchCreateMode,
    handleCreateAndCheckoutBranch: r.handleCreateAndCheckoutBranch,
    setBranchSearchInputRef: s.setBranchSearchInputRef,
    setBranchCreateInputRef: s.setBranchCreateInputRef,
    newBranchName: s.newBranchName,
    setNewBranchName: s.setNewBranchName,
    setBranchCreateMode: s.setBranchCreateMode,
    canCreateBranch: s.canCreateBranch,
    handleStartCreateBranch: r.handleStartCreateBranch,
  };
}

function buildWorkspaceViewModel(
  s: AppState,
  p: ProviderActions,
  r: BuildAppViewModelsArgs["reviewActions"]
): WorkspaceViewModel {
  return {
    repoSidebar: buildWorkspaceRepoSidebarModel(s, p),
    header: buildWorkspaceHeaderModel(s, p),
    mainPane: buildWorkspaceMainPaneModel(s, r),
    reviewSidebar: buildWorkspaceReviewSidebarModel(s, r),
  };
}

export function buildAppViewModels(args: BuildAppViewModelsArgs) {
  const s = args.state;
  const p = args.providerActions;
  const r = args.reviewActions;

  return {
    settingsViewModel: buildSettingsViewModel(s, p),
    workspaceViewModel: buildWorkspaceViewModel(s, p, r),
  };
}
