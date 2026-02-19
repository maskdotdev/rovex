import { createSignal } from "solid-js";

export function useProviderState() {
  const [providerToken, setProviderToken] = createSignal("");
  const [repositoryInput, setRepositoryInput] = createSignal("");
  const [destinationRoot, setDestinationRoot] = createSignal("");
  const [localProjectPath, setLocalProjectPath] = createSignal("");
  const [providerBusy, setProviderBusy] = createSignal(false);
  const [providerError, setProviderError] = createSignal<string | null>(null);
  const [providerStatus, setProviderStatus] = createSignal<string | null>(null);
  const [deviceAuthInProgress, setDeviceAuthInProgress] = createSignal(false);
  const [deviceAuthUserCode, setDeviceAuthUserCode] = createSignal<string | null>(null);
  const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] = createSignal<string | null>(null);

  return {
    providerToken,
    setProviderToken,
    repositoryInput,
    setRepositoryInput,
    destinationRoot,
    setDestinationRoot,
    localProjectPath,
    setLocalProjectPath,
    providerBusy,
    setProviderBusy,
    providerError,
    setProviderError,
    providerStatus,
    setProviderStatus,
    deviceAuthInProgress,
    setDeviceAuthInProgress,
    deviceAuthUserCode,
    setDeviceAuthUserCode,
    deviceAuthVerificationUrl,
    setDeviceAuthVerificationUrl,
  };
}
