import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  completePrompt,
  deletePrompt,
  fetchFreeModels,
  getSettings,
  listSavedPrompts,
  onOpenSettings,
  optimizePrompt,
  saveLastPrompt,
  savePrompt,
  saveSettings,
  type OpenRouterModel,
  type SavedPrompt,
  type Settings,
} from "../lib/api";
import { checkForUpdate, downloadAndInstallUpdate, type UpdateInfo } from "../lib/updates";

export interface UiState {
  augmenting: boolean;
  canUndo: boolean;
}

export function useApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savePanelError, setSavePanelError] = useState<string | null>(null);

  // update state
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  // settings panel transient state
  const [keyInput, setKeyInput] = useState("");
  const [modelSelect, setModelSelect] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "verifying" | "ok" | "error">("idle");
  const [verifyError, setVerifyError] = useState("");

  // main input + augment lifecycle
  const [input, setInput] = useState("");
  const [augmenting, setAugmenting] = useState(false);
  const [undoState, setUndoState] = useState<{ before: string; after: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against double-firing on effect re-run (React StrictMode) so the
  // second invocation aborts the first instead of running two requests.
  const augmentRunRef = useRef(false);
  const augmentingRef = useRef(false);

  // Load persisted settings on mount.
  useEffect(() => {
    let mounted = true;
    getSettings()
      .then((s) => {
        if (!mounted) return;
        setSettings(s);
        setKeyInput(s.api_key);
        setModelSelect(s.model);
        setLaunchAtLogin(s.launch_at_login);
        if (s.last_prompt) setInput(s.last_prompt);
        if (s.api_key) {
          fetchFreeModels(s.api_key)
            .then((m) => {
              if (mounted) {
                setModels(m);
                setModelsLoaded(true);
              }
            })
            .catch(() => {
              if (mounted) setModelsLoaded(true);
            });
        } else {
          setModelsLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) setModelsLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Tray "Settings…" menu item opens the panel.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOpenSettings(() => setSettingsOpen(true)).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  // Check for updates (silent = suppress error text at launch).
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checkUpdate = useCallback(async (silent: boolean) => {
    setCheckingUpdate(true);
    setUpdateError(null);
    const { available, info, error } = await checkForUpdate();
    setCheckingUpdate(false);
    if (error) {
      if (!silent) setUpdateError(error);
      setUpdateInfo(null);
      setUpdateAvailable(false);
      return;
    }
    setUpdateInfo(info);
    setUpdateAvailable(available);
  }, []);

  useEffect(() => {
    let mounted = true;
    getVersion()
      .then((v) => {
        if (mounted) setAppVersion(v);
      })
      .catch(() => {});
    checkUpdate(true);
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo) return;
    setDownloadingUpdate(true);
    setDownloadProgress(0);
    try {
      await downloadAndInstallUpdate(updateInfo.version);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Update download failed");
    } finally {
      setDownloadingUpdate(false);
    }
  }, [updateInfo]);

  // Auto-hide window on blur (click outside) with a grace period so the tray
  // toggle still works — the Rust handler hides/shows before the timer fires.
  useEffect(() => {
    const win = getCurrentWindow();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unlistenBlur: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    win.listen("tauri://blur", () => {
      timeout = setTimeout(() => {
        win.hide();
      }, 200);
    }).then((fn) => (unlistenBlur = fn));
    win.listen("tauri://focus", () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }).then((fn) => (unlistenFocus = fn));
    return () => {
      unlistenBlur?.();
      unlistenFocus?.();
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  const canUndo = undoState !== null && input === undoState.after;

  const augment = useCallback(async () => {
    if (augmentingRef.current) return;
    const text = input.trim();
    if (!text || augmenting || !settings) return;
    if (!settings.api_key) {
      setSettingsOpen(true);
      return;
    }
    if (!settings.model) {
      setSettingsOpen(true);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    // StrictMode (and any re-render re-dispatch) can invoke augment twice back
    // to back; only the first run may proceed — the second aborts the first.
    if (augmentRunRef.current) {
      abortRef.current = null;
      controller.abort();
      return;
    }
    augmentRunRef.current = true;
    augmentingRef.current = true;
    setAugmenting(true);
    try {
      const prompt = optimizePrompt(text);
      const result = await completePrompt(settings.api_key, settings.model, prompt, controller.signal);
      if (controller.signal.aborted) return;
      setInput(result);
      setUndoState({ before: text, after: result });
      setCopied(false);
      saveLastPrompt(result).catch(() => {});
    } catch (err) {
      if (controller.signal.aborted) return;
      alert(err instanceof Error && err.message ? err.message : "Couldn't augment the input");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      augmentRunRef.current = false;
      augmentingRef.current = false;
      setAugmenting(false);
    }
  }, [input, augmenting, settings]);

  const cancel = useCallback(() => {
    augmentRunRef.current = false;
    augmentingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setAugmenting(false);
  }, []);

  const undo = useCallback(() => {
    if (!undoState) return;
    setInput(undoState.before);
    setUndoState(null);
    setCopied(false);
  }, [undoState]);

  const copyResult = useCallback(async () => {
    if (!undoState) return;
    try {
      await navigator.clipboard.writeText(undoState.after);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("Couldn't copy to clipboard");
    }
  }, [undoState]);

  // Saved prompts: list + actions.
  const refreshSaved = useCallback(async () => {
    setSavedError(null);
    try {
      setSavedPrompts(await listSavedPrompts());
    } catch (err) {
      setSavedError(err instanceof Error && err.message ? err.message : "Couldn't load saved prompts");
    } finally {
      setSavedLoaded(true);
    }
  }, []);

  const openSaved = useCallback(async () => {
    setSavedOpen(true);
    if (!savedLoaded) await refreshSaved();
  }, [savedLoaded, refreshSaved]);

  const closeSaved = useCallback(() => setSavedOpen(false), []);

  const doSavePrompt = useCallback(async (title: string, text: string): Promise<boolean> => {
    setSavePanelError(null);
    try {
      await savePrompt(title, text);
      return true;
    } catch (err) {
      setSavePanelError(err instanceof Error && err.message ? err.message : "Couldn't save the prompt");
      return false;
    }
  }, []);

  const doDeletePrompt = useCallback(
    async (id: string) => {
      try {
        await deletePrompt(id);
        setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        alert(err instanceof Error && err.message ? err.message : "Couldn't delete the saved prompt");
      }
    },
    [],
  );

  // Settings: verify the API key, then load free models.
  const verifyAndFetch = useCallback(async () => {
    const key = keyInput.trim();
    if (!key) {
      setVerifyStatus("error");
      setVerifyError("Enter your OpenRouter API key first");
      return;
    }
    setVerifyStatus("verifying");
    setVerifyError("");
    try {
      await saveSettings({ ...(settings ?? { api_key: "", model: "", launch_at_login: false, last_prompt: "" }), api_key: key });
      const list = await fetchFreeModels(key);
      setModels(list);
      setModelsLoaded(true);
      setVerifyStatus("ok");
      const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, last_prompt: "" }), api_key: key };
      if (!next.model || !list.some((m) => m.id === next.model)) {
        if (list.length > 0) next.model = list[0].id;
      }
      setSettings(next);
      await saveSettings(next);
    } catch (err) {
      setVerifyStatus("error");
      setVerifyError(err instanceof Error && err.message ? err.message : "Couldn't verify the API key");
    }
  }, [keyInput, settings]);

  const saveModel = useCallback(
    async (modelId: string) => {
      const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, last_prompt: "" }), model: modelId };
      setSettings(next);
      setModelSelect(modelId);
      await saveSettings(next);
    },
    [settings],
  );

  const toggleLaunchAtLogin = useCallback(async () => {
    const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, last_prompt: "" }), launch_at_login: !launchAtLogin };
    setLaunchAtLogin(next.launch_at_login);
    setSettings(next);
    try {
      if (next.launch_at_login) {
        await invoke("plugin:autostart|enable");
      } else {
        await invoke("plugin:autostart|disable");
      }
      await saveSettings(next);
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : "Couldn't update launch-at-login");
    }
  }, [settings, launchAtLogin]);

  return {
    settings,
    input,
    setInput,
    augmenting,
    canUndo,
    undoState,
    copied,
    augment,
    cancel,
    undo,
    copyResult,
    settingsOpen,
    setSettingsOpen,
    savedOpen,
    setSavedOpen,
    openSaved,
    closeSaved,
    savedPrompts,
    savedLoaded,
    savedError,
    refreshSaved,
    doSavePrompt,
    doDeletePrompt,
    savePanelError,
    setSavePanelError,
    models,
    modelsLoaded,
    keyInput,
    setKeyInput,
    modelSelect,
    setModelSelect,
    launchAtLogin,
    setLaunchAtLogin,
    verifyStatus,
    verifyError,
    setVerifyStatus,
    setVerifyError,
    verifyAndFetch,
    saveModel,
    toggleLaunchAtLogin,
    appVersion,
    updateAvailable,
    updateInfo,
    checkingUpdate,
    updateError,
    downloadingUpdate,
    downloadProgress,
    checkUpdate,
    downloadUpdate,
  };
}
