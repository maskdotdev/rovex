import { For, type Accessor } from "solid-js";
import { ArrowLeft } from "lucide-solid";
import { settingsNavItems } from "@/app/constants";
import type { SettingsTab } from "@/app/types";

type SettingsSidebarProps = {
  activeSettingsTab: Accessor<SettingsTab>;
  onSelectTab: (tab: SettingsTab) => void;
  onBack: () => void;
};

export function SettingsSidebar(props: SettingsSidebarProps) {
  return (
    <aside class="w-[260px] shrink-0 px-3 py-5">
      <button
        type="button"
        class="group mb-5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
        onClick={props.onBack}
      >
        <ArrowLeft class="size-4 transition-transform group-hover:-translate-x-0.5" />
        <span class="text-[14px] font-medium">Back</span>
      </button>

      <nav class="space-y-0.5">
        <For each={settingsNavItems}>
          {(item) => {
            const Icon = item.icon;
            const isActive = () => props.activeSettingsTab() === item.id;
            return (
              <button
                type="button"
                class={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition-all duration-150 ${isActive()
                  ? "bg-white/[0.07] font-medium text-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-200"
                  }`}
                onClick={() => props.onSelectTab(item.id)}
              >
                <Icon class={`size-4 ${isActive() ? "text-amber-400/70" : "text-neutral-500"}`} />
                <span>{item.label}</span>
              </button>
            );
          }}
        </For>
      </nav>
    </aside>
  );
}
