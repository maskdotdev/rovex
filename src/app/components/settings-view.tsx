import { For, Show, Suspense, createMemo, lazy, type Accessor, type Setter } from "solid-js";
import { FolderOpen, PlugZap } from "lucide-solid";
import { Button } from "@/components/button";
import { TextField, TextFieldInput } from "@/components/text-field";
import {
  diffThemePresets,
  diffThemePreviewPatch,
  providerOptions,
  settingsNavItems,
} from "@/app/constants";
import { SettingsSidebar } from "@/app/components/settings-sidebar";
import type {
  DiffThemePreset,
  FileOpenWith,
  ProviderOption,
  SettingsTab,
} from "@/app/types";
import type {
  AppServerAccountStatus,
  AiReviewConfig,
  OpencodeSidecarStatus,
  ProviderConnection,
  ProviderKind,
} from "@/lib/backend";

export type SettingsViewModel = {
  activeSettingsTab: Accessor<SettingsTab>;
  setActiveSettingsTab: Setter<SettingsTab>;
  closeSettings: () => void;
  selectedDiffThemeId: Accessor<string>;
  setSelectedDiffThemeId: Setter<string>;
  selectedDiffTheme: Accessor<DiffThemePreset>;
  settingsError: Accessor<string | null>;
  handleOpenDiffsDocs: () => void | Promise<void>;
  selectedProvider: Accessor<ProviderKind>;
  setSelectedProvider: Setter<ProviderKind>;
  selectedProviderOption: Accessor<ProviderOption>;
  selectedProviderConnection: Accessor<ProviderConnection | null | undefined>;
  providerBusy: Accessor<boolean>;
  providerToken: Accessor<string>;
  setProviderToken: Setter<string>;
  providerConnectionError: Accessor<string | null>;
  providerError: Accessor<string | null>;
  providerStatus: Accessor<string | null>;
  deviceAuthInProgress: Accessor<boolean>;
  deviceAuthUserCode: Accessor<string | null>;
  openDeviceVerificationUrl: (providerLabel: string) => void | Promise<void>;
  handleStartDeviceAuth: () => void | Promise<void>;
  handleConnectProvider: (event: Event) => void | Promise<void>;
  handleDisconnectProvider: () => void | Promise<void>;
  handleCloneRepository: (event: Event) => void | Promise<void>;
  repositoryInput: Accessor<string>;
  setRepositoryInput: Setter<string>;
  destinationRoot: Accessor<string>;
  setDestinationRoot: Setter<string>;
  localProjectPath: Accessor<string>;
  setLocalProjectPath: Setter<string>;
  handlePickDestinationRoot: () => void | Promise<void>;
  handlePickLocalProject: () => void | Promise<void>;
  handleCreateLocalProjectThread: (event: Event) => void | Promise<void>;
  aiReviewConfig: Accessor<AiReviewConfig | undefined>;
  aiReviewProviderInput: Accessor<string>;
  setAiReviewProviderInput: Setter<string>;
  aiReviewModelInput: Accessor<string>;
  setAiReviewModelInput: Setter<string>;
  aiOpencodeProviderInput: Accessor<string>;
  setAiOpencodeProviderInput: Setter<string>;
  aiOpencodeModelInput: Accessor<string>;
  setAiOpencodeModelInput: Setter<string>;
  aiSettingsBusy: Accessor<boolean>;
  aiSettingsError: Accessor<string | null>;
  aiSettingsStatus: Accessor<string | null>;
  aiReviewConfigLoadError: Accessor<string | null>;
  handleSaveAiSettings: (event: Event) => void | Promise<void>;
  appServerAccountStatus: Accessor<AppServerAccountStatus | undefined>;
  appServerAccountLoadError: Accessor<string | null>;
  appServerAuthBusy: Accessor<boolean>;
  appServerAuthError: Accessor<string | null>;
  appServerAuthStatus: Accessor<string | null>;
  handleSwitchAppServerAccount: () => void | Promise<void>;
  handleRefreshAppServerAccountStatus: () => void | Promise<void>;
  maskAccountEmail: Accessor<boolean>;
  setMaskAccountEmail: Setter<boolean>;
  fileOpenWith: Accessor<FileOpenWith>;
  setFileOpenWith: Setter<FileOpenWith>;
  ghosttyOpenCommand: Accessor<string>;
  setGhosttyOpenCommand: Setter<string>;
  opencodeSidecarStatus: Accessor<OpencodeSidecarStatus | undefined>;
  opencodeSidecarLoadError: Accessor<string | null>;
  aiApiKeyInput: Accessor<string>;
  setAiApiKeyInput: Setter<string>;
  aiApiKeyBusy: Accessor<boolean>;
  aiApiKeyError: Accessor<string | null>;
  aiApiKeyStatus: Accessor<string | null>;
  handleSaveAiApiKey: (event: Event) => void | Promise<void>;
};

type SettingsViewProps = {
  model: SettingsViewModel;
};

const LazyDiffViewer = lazy(async () => {
  const module = await import("@/components/diff-viewer");
  return { default: module.DiffViewer };
});

export function SettingsView(props: SettingsViewProps) {
  const {
    activeSettingsTab,
    setActiveSettingsTab,
    closeSettings,
    selectedDiffThemeId,
    setSelectedDiffThemeId,
    selectedDiffTheme,
    settingsError,
    handleOpenDiffsDocs,
    selectedProvider,
    setSelectedProvider,
    selectedProviderOption,
    selectedProviderConnection,
    providerBusy,
    providerToken,
    setProviderToken,
    providerConnectionError,
    providerError,
    providerStatus,
    deviceAuthInProgress,
    deviceAuthUserCode,
    openDeviceVerificationUrl,
    handleStartDeviceAuth,
    handleConnectProvider,
    handleDisconnectProvider,
    handleCloneRepository,
    repositoryInput,
    setRepositoryInput,
    destinationRoot,
    setDestinationRoot,
    localProjectPath,
    setLocalProjectPath,
    handlePickDestinationRoot,
    handlePickLocalProject,
    handleCreateLocalProjectThread,
    aiReviewConfig,
    aiReviewProviderInput,
    setAiReviewProviderInput,
    aiReviewModelInput,
    setAiReviewModelInput,
    aiOpencodeProviderInput,
    setAiOpencodeProviderInput,
    aiOpencodeModelInput,
    setAiOpencodeModelInput,
    aiSettingsBusy,
    aiSettingsError,
    aiSettingsStatus,
    aiReviewConfigLoadError,
    handleSaveAiSettings,
    appServerAccountStatus,
    appServerAccountLoadError,
    appServerAuthBusy,
    appServerAuthError,
    appServerAuthStatus,
    handleSwitchAppServerAccount,
    handleRefreshAppServerAccountStatus,
    maskAccountEmail,
    setMaskAccountEmail,
    fileOpenWith,
    setFileOpenWith,
    ghosttyOpenCommand,
    setGhosttyOpenCommand,
    opencodeSidecarStatus,
    opencodeSidecarLoadError,
    aiApiKeyInput,
    setAiApiKeyInput,
    aiApiKeyBusy,
    aiApiKeyError,
    aiApiKeyStatus,
    handleSaveAiApiKey,
  } = props.model;

  const selectedSettingsItem = createMemo(() => {
    const selected = settingsNavItems.find((item) => item.id === activeSettingsTab());
    return selected ?? settingsNavItems[0];
  });
  const appServerModels = createMemo(() => appServerAccountStatus()?.models ?? []);
  const defaultAppServerModelId = createMemo(
    () => appServerModels().find((model) => model.isDefault)?.id ?? appServerModels()[0]?.id ?? ""
  );

  return (
          <div class="h-svh w-full p-2 md:p-3">
            <section class="glass-surface flex h-[calc(100svh-1rem)] overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_20px_50px_rgba(0,0,0,0.4)] md:h-[calc(100svh-1.5rem)]">
              <SettingsSidebar
                activeSettingsTab={activeSettingsTab}
                onSelectTab={setActiveSettingsTab}
                onBack={closeSettings}
              />

              {/* Settings content */}
              <main class="min-h-0 flex-1 overflow-y-auto px-8 py-8 md:px-12 md:py-10">
                <div class="animate-fade-up">
                  <h1 class="app-title text-[clamp(2rem,2.8vw,3rem)] text-neutral-100">
                    {selectedSettingsItem().label}
                  </h1>
                  <p class="mt-2 max-w-lg text-[15px] leading-relaxed text-neutral-500">
                    {selectedSettingsItem().description}
                  </p>
                </div>

                <Show
                  when={activeSettingsTab() === "connections"}
                  fallback={
                    <Show
                      when={activeSettingsTab() === "personalization"}
                      fallback={
                        <Show
                          when={activeSettingsTab() === "environments"}
                          fallback={
                            <Show
                              when={activeSettingsTab() === "general"}
                              fallback={
                                <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                                  <p class="text-[15px] font-medium text-neutral-200">{selectedSettingsItem().label}</p>
                                  <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                                    This section is ready for settings controls. Select Connections or Environments to configure active integrations.
                                  </p>
                                </section>
                              }
                            >
                              <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                                <p class="text-[15px] font-medium text-neutral-200">Open files</p>
                                <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                                  When you click a diff file name, Rovex will launch the file with your selected app.
                                </p>

                                <div class="mt-4 grid gap-2 sm:grid-cols-3">
                                  <button
                                    type="button"
                                    class={`rounded-xl border px-3 py-2 text-left text-[13px] transition ${
                                      fileOpenWith() === "vscode"
                                        ? "border-amber-300/50 bg-amber-300/12 text-amber-100"
                                        : "border-white/[0.08] bg-white/[0.015] text-neutral-300 hover:border-white/[0.18]"
                                    }`}
                                    onClick={() => setFileOpenWith("vscode")}
                                  >
                                    VS Code
                                  </button>
                                  <button
                                    type="button"
                                    class={`rounded-xl border px-3 py-2 text-left text-[13px] transition ${
                                      fileOpenWith() === "cursor"
                                        ? "border-amber-300/50 bg-amber-300/12 text-amber-100"
                                        : "border-white/[0.08] bg-white/[0.015] text-neutral-300 hover:border-white/[0.18]"
                                    }`}
                                    onClick={() => setFileOpenWith("cursor")}
                                  >
                                    Cursor
                                  </button>
                                  <button
                                    type="button"
                                    class={`rounded-xl border px-3 py-2 text-left text-[13px] transition ${
                                      fileOpenWith() === "ghostty"
                                        ? "border-amber-300/50 bg-amber-300/12 text-amber-100"
                                        : "border-white/[0.08] bg-white/[0.015] text-neutral-300 hover:border-white/[0.18]"
                                    }`}
                                    onClick={() => setFileOpenWith("ghostty")}
                                  >
                                    Ghostty
                                  </button>
                                </div>

                                <Show when={fileOpenWith() === "ghostty"}>
                                  <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                                    <p class="text-[13px] font-medium text-neutral-200">Ghostty command</p>
                                    <p class="mt-1 text-[12.5px] text-neutral-500">
                                      Use <span class="font-mono text-neutral-300">{"{file}"}</span> where the full file path should go.
                                    </p>
                                    <TextField class="mt-3">
                                      <TextFieldInput
                                        value={ghosttyOpenCommand()}
                                        onInput={(event) => setGhosttyOpenCommand(event.currentTarget.value)}
                                        placeholder="nvim {file}"
                                      />
                                    </TextField>
                                  </div>
                                </Show>

                                <div class="mt-6 border-t border-white/[0.06] pt-5">
                                  <p class="text-[15px] font-medium text-neutral-200">Privacy</p>
                                  <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                                    Control whether your full Codex account email is visible in sidebar account widgets.
                                  </p>

                                  <label class="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                                    <input
                                      type="checkbox"
                                      checked={maskAccountEmail()}
                                      onChange={(event) => setMaskAccountEmail(event.currentTarget.checked)}
                                      class="mt-0.5 h-4 w-4 rounded border-white/[0.3] bg-transparent accent-amber-500"
                                    />
                                    <span>
                                      <span class="block text-[13.5px] font-medium text-neutral-200">
                                        Hide account email
                                      </span>
                                      <span class="mt-1 block text-[12.5px] leading-relaxed text-neutral-500">
                                        When enabled, the sidebar account label shows <span class="font-mono text-neutral-400">Hidden</span> instead of your full email address.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                              </section>
                            </Show>
                          }
                        >
                          <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                            <p class="text-[15px] font-medium text-neutral-200">
                              AI Review Provider
                            </p>
                            <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                              Configure which backend provider and model power reviews. Settings are applied immediately and persisted to <span class="font-mono text-neutral-300">.env</span>.
                            </p>

                            <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                  Active provider
                                </p>
                                <span
                                  class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11.5px] font-medium tracking-wide text-neutral-300"
                                >
                                  {(aiReviewConfig()?.reviewProvider ?? "openai").toUpperCase()}
                                </span>
                              </div>
                              <p class="mt-2 text-[13px] text-neutral-400">
                                Model: <span class="font-mono text-neutral-300">{aiReviewConfig()?.reviewModel ?? "gpt-4.1-mini"}</span>
                              </p>
                              <Show when={aiReviewConfig()?.envFilePath}>
                                {(envPath) => (
                                  <p class="mt-2 text-[12px] leading-relaxed text-neutral-500">
                                    Saved to <span class="font-mono text-neutral-400">{envPath()}</span>
                                  </p>
                                )}
                              </Show>
                            </div>

                            <form class="mt-4 max-w-xl space-y-3" onSubmit={(event) => void handleSaveAiSettings(event)}>
                              <label
                                for="ai-review-provider-select"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                Review provider
                              </label>
                              <select
                                id="ai-review-provider-select"
                                value={aiReviewProviderInput()}
                                onChange={(event) => setAiReviewProviderInput(event.currentTarget.value)}
                                class="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[14px] text-neutral-200 outline-none transition-colors hover:border-white/[0.14] focus:border-amber-500/35"
                              >
                                <option value="openai">openai</option>
                                <option value="opencode">opencode</option>
                                <option value="app-server">app-server</option>
                              </select>

                              <label
                                for="ai-review-model-input"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                Review model
                              </label>
                              <TextField>
                                <TextFieldInput
                                  id="ai-review-model-input"
                                  type="text"
                                  list={aiReviewProviderInput() === "app-server" ? "app-server-model-options" : undefined}
                                  placeholder={
                                    aiReviewProviderInput() === "app-server"
                                      ? defaultAppServerModelId() || "gpt-5.3-codex"
                                      : "gpt-4.1-mini"
                                  }
                                  value={aiReviewModelInput()}
                                  onInput={(event) => setAiReviewModelInput(event.currentTarget.value)}
                                  class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                />
                              </TextField>
                              <Show when={aiReviewProviderInput() === "app-server"}>
                                <datalist id="app-server-model-options">
                                  <For each={appServerModels()}>
                                    {(model) => (
                                      <option value={model.id}>{model.displayName}</option>
                                    )}
                                  </For>
                                </datalist>
                              </Show>

                              <Show when={aiReviewProviderInput() === "opencode"}>
                                <>
                                  <label
                                    for="opencode-provider-input"
                                    class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                                  >
                                    OpenCode provider fallback
                                  </label>
                                  <TextField>
                                    <TextFieldInput
                                      id="opencode-provider-input"
                                      type="text"
                                      placeholder="openai"
                                      value={aiOpencodeProviderInput()}
                                      onInput={(event) => setAiOpencodeProviderInput(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>

                                  <label
                                    for="opencode-model-input"
                                    class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                                  >
                                    OpenCode model override (optional)
                                  </label>
                                  <TextField>
                                    <TextFieldInput
                                      id="opencode-model-input"
                                      type="text"
                                      placeholder="openai/gpt-5"
                                      value={aiOpencodeModelInput()}
                                      onInput={(event) => setAiOpencodeModelInput(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>

                                  <div class="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                                    <div class="flex items-center justify-between gap-2">
                                      <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                        Bundled sidecar
                                      </p>
                                      <span
                                        class={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${opencodeSidecarStatus()?.available
                                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                                          : "border-rose-500/20 bg-rose-500/10 text-rose-300/90"
                                          }`}
                                      >
                                        {opencodeSidecarStatus()?.available ? "Available" : "Missing"}
                                      </span>
                                    </div>
                                    <Show when={opencodeSidecarStatus()?.version}>
                                      {(version) => (
                                        <p class="mt-2 text-[12px] text-neutral-400">
                                          Version: <span class="font-mono text-neutral-300">{version()}</span>
                                        </p>
                                      )}
                                    </Show>
                                    <Show when={opencodeSidecarStatus()?.detail}>
                                      {(detail) => (
                                        <p class="mt-2 text-[12px] text-neutral-500">{detail()}</p>
                                      )}
                                    </Show>
                                    <Show when={opencodeSidecarLoadError()}>
                                      {(message) => (
                                        <p class="mt-2 text-[12px] text-rose-300/90">{message()}</p>
                                      )}
                                    </Show>
                                  </div>
                                </>
                              </Show>
                              <Show when={aiReviewProviderInput() === "app-server"}>
                                <div class="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                                  <div class="flex items-center justify-between gap-2">
                                    <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                      Codex account
                                    </p>
                                    <span
                                      class={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${appServerAccountStatus()?.available
                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                                        : "border-rose-500/20 bg-rose-500/10 text-rose-300/90"
                                        }`}
                                    >
                                      {appServerAccountStatus()?.available ? "Available" : "Unavailable"}
                                    </span>
                                  </div>
                                  <p class="mt-2 text-[12px] text-neutral-400">
                                    Account: <span class="font-mono text-neutral-300">{appServerAccountStatus()?.email ?? "Not signed in"}</span>
                                  </p>
                                  <p class="mt-1 text-[12px] text-neutral-400">
                                    Plan: <span class="font-mono text-neutral-300">{appServerAccountStatus()?.planType ?? "Unknown"}</span>
                                  </p>
                                  <p class="mt-1 text-[12px] text-neutral-400">
                                    Models available: <span class="font-mono text-neutral-300">{appServerModels().length}</span>
                                  </p>
                                  <Show when={defaultAppServerModelId()}>
                                    {(model) => (
                                      <p class="mt-1 text-[12px] text-neutral-400">
                                        Default model: <span class="font-mono text-neutral-300">{model()}</span>
                                      </p>
                                    )}
                                  </Show>
                                  <Show when={appServerAccountStatus()?.detail}>
                                    {(detail) => (
                                      <p class="mt-2 text-[12px] text-neutral-500">{detail()}</p>
                                    )}
                                  </Show>
                                  <Show when={appServerAccountLoadError()}>
                                    {(message) => (
                                      <p class="mt-2 text-[12px] text-rose-300/90">{message()}</p>
                                    )}
                                  </Show>
                                  <div class="mt-3 flex flex-wrap items-center gap-3">
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={appServerAuthBusy()}
                                      onClick={() => void handleSwitchAppServerAccount()}
                                    >
                                      {appServerAuthBusy() ? "Working..." : "Switch Codex account"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      class="h-9 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                                      disabled={appServerAuthBusy()}
                                      onClick={() => void handleRefreshAppServerAccountStatus()}
                                    >
                                      Refresh status
                                    </Button>
                                    <Show when={defaultAppServerModelId().length > 0}>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        class="h-9 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                                        onClick={() => setAiReviewModelInput(defaultAppServerModelId())}
                                      >
                                        Use default model
                                      </Button>
                                    </Show>
                                  </div>
                                  <Show when={appServerAuthError()}>
                                    {(message) => (
                                      <p class="mt-2 text-[12px] text-rose-300/90">{message()}</p>
                                    )}
                                  </Show>
                                  <Show when={appServerAuthStatus()}>
                                    {(message) => (
                                      <p class="mt-2 text-[12px] text-emerald-300/90">{message()}</p>
                                    )}
                                  </Show>
                                </div>
                              </Show>
                              <div class="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={aiSettingsBusy() || aiReviewModelInput().trim().length === 0}
                                >
                                  {aiSettingsBusy() ? "Saving..." : "Save review settings"}
                                </Button>
                              </div>
                            </form>

                            <p class="mt-8 text-[15px] font-medium text-neutral-200">
                              AI Review API Key
                            </p>
                            <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                              Configure <span class="font-mono text-neutral-300">OPENAI_API_KEY</span> for OpenAI-backed models.
                            </p>

                            <div class="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                                  Current key
                                </p>
                                <span
                                  class={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${aiReviewConfig()?.hasApiKey
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                                    : "border-white/[0.06] bg-white/[0.03] text-neutral-500"
                                    }`}
                                >
                                  {aiReviewConfig()?.hasApiKey ? "Configured" : "Missing"}
                                </span>
                              </div>
                              <p class="mt-2 text-[13px] text-neutral-400">
                                <Show
                                  when={aiReviewConfig()?.apiKeyPreview}
                                  fallback="No API key configured yet."
                                >
                                  {(preview) => (
                                    <span class="font-mono text-neutral-300">{preview()}</span>
                                  )}
                                </Show>
                              </p>
                            </div>

                            <form class="mt-4" onSubmit={(event) => void handleSaveAiApiKey(event)}>
                              <label
                                for="openai-api-key-input"
                                class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                              >
                                OPENAI_API_KEY
                              </label>
                              <TextField class="mt-2 max-w-xl">
                                <TextFieldInput
                                  id="openai-api-key-input"
                                  type="password"
                                  placeholder="sk-proj-..."
                                  value={aiApiKeyInput()}
                                  onInput={(event) => setAiApiKeyInput(event.currentTarget.value)}
                                  class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                />
                              </TextField>
                              <div class="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={aiApiKeyBusy() || aiApiKeyInput().trim().length === 0}
                                >
                                  {aiApiKeyBusy() ? "Saving..." : "Save API key"}
                                </Button>
                                <span class="text-[12px] text-neutral-500">
                                  Applied immediately for this running app and persisted to <span class="font-mono">.env</span>.
                                </span>
                              </div>
                            </form>

                            <Show when={aiSettingsError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiSettingsStatus()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiReviewConfigLoadError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  Unable to load AI review config: {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiApiKeyError()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                            <Show when={aiApiKeyStatus()}>
                              {(message) => (
                                <div class="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                                  {message()}
                                </div>
                              )}
                            </Show>
                          </section>
                        </Show>
                      }
                    >
                      <section class="animate-fade-up mt-10 max-w-3xl rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6" style={{ "animation-delay": "0.08s" }}>
                        <p class="text-[15px] font-medium text-neutral-200">
                          Diff Theme
                        </p>
                        <p class="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
                          Choose which diffs.com theme preset Rovex uses when rendering code diffs.
                        </p>

                        <div class="mt-4 max-w-xl space-y-3">
                          <label
                            for="diff-theme-select"
                            class="block text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500"
                          >
                            Preset
                          </label>
                          <div class="flex flex-wrap items-center gap-2.5">
                            <select
                              id="diff-theme-select"
                              value={selectedDiffThemeId()}
                              onChange={(event) => setSelectedDiffThemeId(event.currentTarget.value)}
                              class="h-11 min-w-[13.5rem] rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[14px] text-neutral-200 outline-none transition-colors hover:border-white/[0.14] focus:border-amber-500/35"
                            >
                              <For each={diffThemePresets}>
                                {(preset) => (
                                  <option value={preset.id}>
                                    {preset.label}
                                  </option>
                                )}
                              </For>
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                              onClick={() => void handleOpenDiffsDocs()}
                            >
                              Browse diffs.com
                            </Button>
                          </div>
                          <p class="text-[13px] leading-relaxed text-neutral-500">
                            {selectedDiffTheme().description}
                          </p>
                          <p class="text-[12.5px] leading-relaxed text-neutral-500">
                            Dark: <span class="font-mono text-neutral-300">{selectedDiffTheme().theme.dark}</span>
                            {" "}
                            Light: <span class="font-mono text-neutral-300">{selectedDiffTheme().theme.light}</span>
                          </p>
                        </div>

                        <div class="mt-6">
                          <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">
                            Live Preview
                          </p>
                          <div class="mt-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0e1013] p-3">
                            <div class="max-h-[16rem] overflow-y-auto pr-1">
                              <Suspense
                                fallback={
                                  <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-[13px] text-neutral-400">
                                    Loading preview...
                                  </div>
                                }
                              >
                                <LazyDiffViewer
                                  patch={diffThemePreviewPatch}
                                  theme={selectedDiffTheme().theme}
                                  themeId={selectedDiffTheme().id}
                                  themeType="dark"
                                  showToolbar={false}
                                />
                              </Suspense>
                            </div>
                          </div>
                        </div>

                        <Show when={settingsError()}>
                          {(message) => (
                            <div class="mt-4 rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                              {message()}
                            </div>
                          )}
                        </Show>
                      </section>
                    </Show>
                  }
                >
                  <div class="mt-10 max-w-3xl space-y-5">
                    <section class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5" style={{ "animation-delay": "0.05s" }}>
                      <p class="text-[12px] font-medium uppercase tracking-[0.09em] text-neutral-500">Provider</p>
                      <div class="mt-3 inline-flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
                        <For each={providerOptions}>
                          {(option) => (
                            <button
                              type="button"
                              class={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${selectedProvider() === option.id
                                ? "bg-white/[0.1] text-neutral-100"
                                : "text-neutral-400 hover:text-neutral-200"
                                }`}
                              onClick={() => setSelectedProvider(option.id)}
                            >
                              {option.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </section>

                    {/* Provider connection card */}
                    <section class="animate-fade-up overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02]" style={{ "animation-delay": "0.08s" }}>
                      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.04] px-6 py-5">
                        <div>
                          <div class="flex items-center gap-2.5">
                            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
                              <PlugZap class="size-4 text-neutral-300" />
                            </div>
                            <p class="text-[15px] font-medium text-neutral-100">{selectedProviderOption().label}</p>
                          </div>
                          <p class="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
                            {selectedProviderOption().description}
                          </p>
                        </div>
                        <span
                          class={`mt-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium tracking-wide ${selectedProviderConnection()
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/90"
                            : "border-white/[0.06] bg-white/[0.03] text-neutral-500"
                            }`}
                        >
                          {selectedProviderConnection() ? "Connected" : "Not connected"}
                        </span>
                      </div>

                      <div class="px-6 py-5">
                        <Show
                          when={selectedProviderConnection()}
                          fallback={
                            <div class="max-w-md space-y-3">
                              <Button
                                type="button"
                                size="sm"
                                disabled={providerBusy() || deviceAuthInProgress()}
                                onClick={() => void handleStartDeviceAuth()}
                              >
                                {providerBusy()
                                  ? "Starting..."
                                  : deviceAuthInProgress()
                                    ? "Waiting for approval..."
                                    : `Connect with ${selectedProviderOption().label}`}
                              </Button>
                              <Show when={deviceAuthInProgress() && deviceAuthUserCode()}>
                                {(userCode) => (
                                  <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200/90">
                                    Enter code <span class="font-semibold tracking-[0.08em]">{userCode()}</span> on {selectedProviderOption().label}.
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      class="mt-3 border-white/[0.1] text-neutral-200 hover:border-white/[0.18]"
                                      onClick={() => void openDeviceVerificationUrl(selectedProviderOption().label)}
                                    >
                                      Open {selectedProviderOption().label} verification
                                    </Button>
                                  </div>
                                )}
                              </Show>
                              <details class="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[13px] text-neutral-400">
                                <summary class="cursor-pointer font-medium text-neutral-300">
                                  Use personal access token instead
                                </summary>
                                <form class="mt-3 space-y-3" onSubmit={(event) => void handleConnectProvider(event)}>
                                  <TextField>
                                    <TextFieldInput
                                      type="password"
                                      placeholder={selectedProviderOption().tokenPlaceholder}
                                      value={providerToken()}
                                      onInput={(event) => setProviderToken(event.currentTarget.value)}
                                      class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                                    />
                                  </TextField>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={providerBusy() || providerToken().trim().length === 0}
                                  >
                                    {providerBusy() ? "Connecting..." : "Connect with token"}
                                  </Button>
                                </form>
                              </details>
                            </div>
                          }
                        >
                          {(connection) => (
                            <div class="flex flex-wrap items-center justify-between gap-3">
                              <p class="text-[14px] text-neutral-400">
                                Authenticated as <span class="font-medium text-amber-300/90">{connection().accountLogin}</span>
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                class="border-white/[0.08] text-neutral-300 hover:border-white/[0.12]"
                                disabled={providerBusy()}
                                onClick={() => void handleDisconnectProvider()}
                              >
                                Disconnect
                              </Button>
                            </div>
                          )}
                        </Show>
                      </div>
                    </section>

                    {/* Clone form card */}
                    <form
                      class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5"
                      style={{ "animation-delay": "0.14s" }}
                      onSubmit={(event) => void handleCloneRepository(event)}
                    >
                      <p class="text-[15px] font-medium text-neutral-200">Clone repository for review</p>
                      <p class="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">
                        {selectedProviderOption().repositoryHint}
                      </p>

                      <TextField class="mt-4 max-w-md">
                        <TextFieldInput
                          placeholder={selectedProvider() === "gitlab" ? "group/subgroup/repository" : "owner/repository"}
                          value={repositoryInput()}
                          onInput={(event) => setRepositoryInput(event.currentTarget.value)}
                          class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                        />
                      </TextField>

                      <div class="mt-3 flex max-w-xl items-center gap-2">
                        <TextField class="min-w-0 flex-1">
                          <TextFieldInput
                            placeholder="Destination root (optional)"
                            value={destinationRoot()}
                            onInput={(event) => setDestinationRoot(event.currentTarget.value)}
                            class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                          />
                        </TextField>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                          onClick={() => void handlePickDestinationRoot()}
                        >
                          <FolderOpen class="mr-1.5 size-4" />
                          Browse
                        </Button>
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        class="mt-4"
                        disabled={
                          providerBusy() ||
                          !selectedProviderConnection() ||
                          repositoryInput().trim().length === 0
                        }
                      >
                        {providerBusy() ? "Working..." : "Clone for review"}
                      </Button>
                    </form>

                    {/* Local project card */}
                    <form
                      class="animate-fade-up rounded-2xl border border-white/[0.05] bg-white/[0.02] px-6 py-5"
                      style={{ "animation-delay": "0.18s" }}
                      onSubmit={(event) => void handleCreateLocalProjectThread(event)}
                    >
                      <p class="text-[15px] font-medium text-neutral-200">Use an existing local project</p>
                      <p class="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">
                        Pick any local directory and create a review thread without cloning.
                      </p>

                      <div class="mt-4 flex max-w-xl items-center gap-2">
                        <TextField class="min-w-0 flex-1">
                          <TextFieldInput
                            placeholder="/path/to/local/project"
                            value={localProjectPath()}
                            onInput={(event) => setLocalProjectPath(event.currentTarget.value)}
                            class="h-11 rounded-xl border-white/[0.06] bg-white/[0.02] text-[14px] text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500/30"
                          />
                        </TextField>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          class="h-11 border-white/[0.08] px-3 text-neutral-200 hover:border-white/[0.12]"
                          onClick={() => void handlePickLocalProject()}
                        >
                          <FolderOpen class="mr-1.5 size-4" />
                          Browse
                        </Button>
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        class="mt-4"
                        disabled={providerBusy() || localProjectPath().trim().length === 0}
                      >
                        {providerBusy() ? "Working..." : "Create review from local project"}
                      </Button>
                    </form>

                    {/* Status messages */}
                    <Show when={providerConnectionError()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                          Unable to load provider connection: {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={providerError()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-rose-500/15 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300/90">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={providerStatus()}>
                      {(message) => (
                        <div class="animate-fade-up rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-300/90">
                          {message()}
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>
              </main>
            </section>
          </div>
  );
}
