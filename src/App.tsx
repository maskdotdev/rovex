import { For } from "solid-js";
import { Button } from "@/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/sidebar";
import { TextField, TextFieldInput } from "@/components/text-field";
import "./App.css";

type PrimaryAction = {
  label: string;
  hint: string;
};

type ThreadItem = {
  title: string;
  age: string;
  diff?: string;
  active?: boolean;
};

type TimelineEntry =
  | { kind: "line"; text: string; tone?: "default" | "muted" | "strong" }
  | { kind: "edit"; file: string; additions: string; deletions: string };

const primaryActions: PrimaryAction[] = [
  { label: "New thread", hint: "N" },
  { label: "Automations", hint: "A" },
  { label: "Skills", hint: "S" },
];

const workspaceThreads: ThreadItem[] = [
  { title: "Plan splitting code...", age: "2d" },
  { title: "Restrict content to ...", age: "3m", active: true },
  { title: "Implement ISSUE-...", age: "1h" },
  { title: "Optimize code-gr...", age: "24m" },
  { title: "Add graph view lik...", age: "1h" },
  { title: "Prefetch GitLab on...", age: "1h" },
  { title: "Add db wip...", age: "2h", diff: "+98 -0" },
  { title: "Investig...", age: "2h", diff: "+1,376 -0" },
  { title: "Investig...", age: "2h", diff: "+354 -249" },
  { title: "Organize log...", age: "2h", diff: "+2 -0" },
  { title: "Plan next...", age: "5h", diff: "+168 -22" },
];

const projectList = ["argus", "thrones", "stellar", "vector-embeddi..."];

const timelineEntries: TimelineEntry[] = [
  {
    kind: "line",
    tone: "muted",
    text: "Ran bunx eslint src/middleware.ts 'src/app/(app)/layout.tsx' ...",
  },
  {
    kind: "line",
    tone: "muted",
    text: "Ran git diff -- src/middleware.ts 'src/app/(app)/layout.tsx' ...",
  },
  { kind: "line", tone: "strong", text: "Ran git status --short" },
  {
    kind: "line",
    tone: "strong",
    text: "Code changes are in place and lint passes on touched files.",
  },
  { kind: "line", tone: "muted", text: "Explored 3 files" },
  {
    kind: "line",
    text: "I spotted one edge case: stale/invalid auth cookies could still hit protected URLs.",
  },
  { kind: "edit", file: "layout.tsx", additions: "+7", deletions: "-3" },
  {
    kind: "edit",
    file: "app-layout-client.tsx",
    additions: "+18",
    deletions: "-1",
  },
  {
    kind: "line",
    tone: "muted",
    text: "Ran bunx tsc --noEmit --pretty false for 3s",
  },
  { kind: "line", tone: "muted", text: "Thinking" },
];

function TimelineRow(props: { entry: TimelineEntry }) {
  if (props.entry.kind === "edit") {
    return (
      <p class="mb-5 text-base text-slate-300">
        Edited <span class="font-semibold text-sky-300">{props.entry.file}</span>{" "}
        <span class="font-semibold text-emerald-400">{props.entry.additions}</span>{" "}
        <span class="font-semibold text-rose-400">{props.entry.deletions}</span>
      </p>
    );
  }

  const toneClass: Record<NonNullable<TimelineEntry["tone"]>, string> = {
    default: "text-slate-200",
    muted: "text-slate-400",
    strong: "font-semibold text-slate-100",
  };

  return (
    <p class={`mb-5 max-w-[86ch] text-base leading-relaxed ${toneClass[props.entry.tone ?? "default"]}`}>
      {props.entry.text}
    </p>
  );
}

function SidebarRow(props: { label: string; right?: string; active?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        class="h-12 rounded-2xl px-4 text-[15px] font-medium text-slate-100/95 data-[active=true]:bg-white/10 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(148,163,184,0.25)] hover:bg-white/8"
      >
        <div class="flex w-full items-center justify-between gap-3">
          <span class="truncate">{props.label}</span>
          <span class="shrink-0 text-[14px] text-slate-400">{props.right}</span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function App() {
  return (
    <SidebarProvider
      defaultOpen
      style={{
        "--sidebar-width": "20rem",
        "--sidebar-width-icon": "3.25rem",
      }}
      class="min-h-svh"
    >
      <Sidebar
        collapsible="offcanvas"
        class="border-r border-sidebar-border/60 bg-[linear-gradient(165deg,rgba(4,8,20,0.92)_0%,rgba(2,5,14,0.98)_70%,rgba(2,8,28,0.92)_100%)]"
      >
        <SidebarHeader class="px-5 pt-4 pb-3">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex gap-2.5">
              <span class="h-5 w-5 rounded-full bg-[#ff5f56]" />
              <span class="h-5 w-5 rounded-full bg-[#ffbd2e]" />
              <span class="h-5 w-5 rounded-full bg-[#27c93f]" />
            </div>
            <SidebarTrigger class="h-8 w-8 rounded-md border border-slate-300/35 text-slate-300 hover:bg-slate-700/30" />
          </div>
        </SidebarHeader>

        <SidebarContent class="px-3">
          <SidebarGroup class="p-0">
            <SidebarMenu>
              <For each={primaryActions}>
                {(action) => <SidebarRow label={action.label} right={action.hint} />}
              </For>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup class="p-0 pt-2">
            <SidebarGroupLabel class="px-4 pb-1 text-xs tracking-[0.12em] text-slate-500">
              Threads
            </SidebarGroupLabel>
            <SidebarMenu>
              <For each={workspaceThreads}>
                {(thread) => (
                  <SidebarRow
                    label={thread.title}
                    right={thread.diff ? `${thread.diff} ${thread.age}` : thread.age}
                    active={thread.active}
                  />
                )}
              </For>
            </SidebarMenu>
            <button
              type="button"
              class="ml-4 mt-2 inline-flex w-fit text-sm text-slate-400 hover:text-slate-200"
            >
              Show more
            </button>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter class="px-3 pb-4">
          <SidebarMenu>
            <For each={projectList}>{(project) => <SidebarRow label={project} />}</For>
          </SidebarMenu>
          <SidebarSeparator class="my-2 bg-slate-700/50" />
          <SidebarMenu>
            <SidebarRow label="Settings" />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset class="bg-transparent p-2 md:p-3">
        <section class="flex h-full min-h-[calc(100svh-1rem)] flex-col rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,15,25,0.84)_0%,rgba(7,10,18,0.95)_100%)] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          <header class="flex items-start justify-between gap-4 border-b border-slate-700/40 px-6 py-4">
            <div class="flex items-start gap-3">
              <SidebarTrigger class="mt-0.5 h-9 w-9 rounded-lg border border-slate-500/40 text-slate-200 hover:bg-slate-700/30" />
              <div>
                <h1 class="app-title text-[clamp(1.15rem,1.5vw,1.65rem)] font-semibold">
                  Restrict content to logged users
                </h1>
                <p class="mt-1 text-sm text-slate-400">argus-app</p>
              </div>
            </div>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" class="border-slate-600/70 text-slate-100">
                Open
              </Button>
              <Button variant="outline" size="sm" class="border-slate-600/70 text-slate-100">
                Commit
              </Button>
            </div>
          </header>

          <div class="flex-1 overflow-y-auto px-6 py-5">
            <For each={timelineEntries}>
              {(entry) => <TimelineRow entry={entry} />}
            </For>
          </div>

          <footer class="px-6 pb-5">
            <div class="mb-3 flex items-center justify-between rounded-full border border-slate-600/40 bg-black/35 px-4 py-2 text-sm text-slate-300">
              <span>
                3 files changed <span class="font-semibold text-emerald-400">+95</span>{" "}
                <span class="font-semibold text-rose-400">-15</span>
              </span>
              <button type="button" class="text-slate-100 hover:text-white">
                Review changes ↗
              </button>
            </div>

            <form
              class="rounded-2xl border border-slate-600/40 bg-black/35 p-3"
              onSubmit={(event) => event.preventDefault()}
            >
              <TextField>
                <TextFieldInput
                  placeholder="Ask for follow-up changes"
                  class="h-12 rounded-xl border-slate-700/60 bg-black/30 text-base text-slate-100 placeholder:text-slate-500"
                />
              </TextField>
              <div class="mt-3 flex items-center gap-3 text-sm text-slate-400">
                <span class="text-xl leading-none text-slate-300">＋</span>
                <span class="text-slate-100">GPT-5.3-Codex</span>
                <span>High</span>
                <Button size="icon" variant="secondary" class="ml-auto h-9 w-9 rounded-full">
                  ●
                </Button>
              </div>
            </form>
          </footer>
        </section>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
