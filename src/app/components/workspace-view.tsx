import { SidebarInset } from "@/components/sidebar";
import {
  WorkspaceHeader,
  type WorkspaceHeaderModel,
} from "@/app/components/workspace-header";
import {
  WorkspaceMainPane,
  type WorkspaceMainPaneModel,
} from "@/app/components/workspace-main-pane";
import {
  WorkspaceRepoSidebar,
  type WorkspaceRepoSidebarModel,
} from "@/app/components/workspace-repo-sidebar";
import {
  WorkspaceReviewSidebar,
  type WorkspaceReviewSidebarModel,
} from "@/app/components/workspace-review-sidebar";

export type WorkspaceViewModel = {
  repoSidebar: WorkspaceRepoSidebarModel;
  header: WorkspaceHeaderModel;
  mainPane: WorkspaceMainPaneModel;
  reviewSidebar: WorkspaceReviewSidebarModel;
};

type WorkspaceViewProps = {
  model: WorkspaceViewModel;
};

export function WorkspaceView(props: WorkspaceViewProps) {
  const model = props.model;

  return (
    <>
      <WorkspaceRepoSidebar model={model.repoSidebar} />

      <SidebarInset class="bg-transparent p-2 md:p-3">
        <section class="glass-surface flex h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
          <WorkspaceHeader model={model.header} />
          <WorkspaceMainPane model={model.mainPane} />
        </section>
      </SidebarInset>

      <WorkspaceReviewSidebar model={model.reviewSidebar} />
    </>
  );
}
