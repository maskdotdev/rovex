import { Show } from "solid-js";
import { SidebarProvider } from "@/components/sidebar";
import { SettingsView } from "@/app/components/settings-view";
import { WorkspaceView } from "@/app/components/workspace-view";
import { useAppController } from "@/app/hooks/use-app-controller";
import "./app.css";

function App() {
  const { activeView, settingsViewModel, workspaceViewModel } = useAppController();

  return (
    <SidebarProvider
      defaultOpen
      style={{
        "--sidebar-width": "18rem",
        "--sidebar-width-icon": "3.25rem",
      }}
      class="min-h-svh"
    >
      <Show
        when={activeView() === "workspace"}
        fallback={<SettingsView model={settingsViewModel} />}
      >
        <WorkspaceView model={workspaceViewModel} />
      </Show>
    </SidebarProvider>
  );
}

export default App;
