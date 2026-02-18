import { Show } from "solid-js";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/sidebar";

type SidebarRowProps = {
  label: string;
  right?: string;
  active?: boolean;
  onClick?: () => void;
};

export function SidebarRow(props: SidebarRowProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        as="button"
        type="button"
        onClick={props.onClick}
        isActive={props.active}
        class="group/row h-11 rounded-xl px-3.5 text-[14px] font-medium text-neutral-400 transition-all duration-150 data-[active=true]:bg-white/[0.06] data-[active=true]:text-neutral-100 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] hover:bg-white/[0.04] hover:text-neutral-200"
      >
        <div class="flex w-full items-center justify-between gap-3">
          <div class="flex min-w-0 items-center">
            <span class="truncate">{props.label}</span>
          </div>
          <Show when={props.right}>
            {(right) => (
              <kbd class="shrink-0 rounded-[5px] border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 font-sans text-[11px] text-neutral-500">
                {right()}
              </kbd>
            )}
          </Show>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
