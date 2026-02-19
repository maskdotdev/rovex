import { useAppEffects } from "@/app/hooks/use-app-effects";
import {
  buildAppEffectsArgs,
  buildProviderAndSettingsActionArgs,
  buildReviewActionArgs,
} from "@/app/hooks/use-app-controller-bindings";
import { useAppState } from "@/app/hooks/use-app-state";
import { buildAppViewModels } from "@/app/hooks/use-app-view-models";
import { useProviderAndSettingsActions } from "@/app/hooks/use-provider-and-settings-actions";
import { useReviewActions } from "@/app/hooks/use-review-actions";

export function useAppController() {
  const s = useAppState();
  const providerActions = useProviderAndSettingsActions(buildProviderAndSettingsActionArgs(s));
  const reviewActions = useReviewActions(buildReviewActionArgs(s));

  useAppEffects(buildAppEffectsArgs(s, reviewActions));

  const { settingsViewModel, workspaceViewModel } = buildAppViewModels({
    state: s,
    providerActions,
    reviewActions,
  });

  return {
    activeView: s.activeView,
    settingsViewModel,
    workspaceViewModel,
  };
}
