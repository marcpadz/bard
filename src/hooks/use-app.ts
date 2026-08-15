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
  renamePrompt,
  saveLastPrompt,
  savePrompt,
  saveSettings,
  writeClipboard,
  type OpenRouterModel,
  type SavedPrompt,
  type Settings,
} from "../lib/api";
import { checkForUpdate, downloadAndInstallUpdate, onUpdateDownloaded, onUpdateFailed, onUpdateProgress, type UpdateInfo } from "../lib/updates";

export interface UiState {
  augmenting: boolean;
  canUndo: boolean;
}

export function useApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelCount, setModelCount] = useState(0);
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
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  // settings panel transient state
  const [keyInput, setKeyInput] = useState("");
  const [modelSelect, setModelSelect] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [showDock, setShowDock] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "verifying" | "ok" | "error">("idle");
  const [verifyError, setVerifyError] = useState("");

  // main input + augment lifecycle
  const [input, setInput] = useState("");
  const [augmenting, setAugmenting] = useState(false);
  const [undoState, setUndoState] = useState<{ before: string; after: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Global error toast. window.alert() is a silent no-op inside Tauri's
  // webview, so every error path must surface in-app instead of via alert().
  // A small stack (not a single message) so two errors in quick succession
  // don't clobber each other — each entry has its own auto-dismiss timer.
  const [errors, setErrors] = useState<{ id: number; message: string }[]>([]);
  const errorTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const errorSeq = useRef(0);
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
        setShowDock(s.show_dock);
        if (s.last_prompt) setInput(s.last_prompt);
        if (s.api_key) {
          fetchFreeModels(s.api_key)
            .then((m) => {
              if (mounted) {
                setModels(m);
                setModelCount(m.length);
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
    // Synchronous guard: a fast second click can slip past the async
    // setDownloadingUpdate, spawning two downloads. Check + set up front.
    if (downloadingUpdate) return;
    setDownloadingUpdate(true);
    setDownloadProgress(0);
    setUpdateError(null);

    // Subscribe to progress events from the Rust side.
    let unlistenProgress: (() => void) | undefined;
    onUpdateProgress((percent) => {
      setDownloadProgress(percent);
    }).then((fn) => (unlistenProgress = fn));

    try {
      // Race between success and failure events from the Rust side.
      const outcome = new Promise<"ok" | string>((resolve) => {
        let unlistenOk: (() => void) | undefined;
        let unlistenFail: (() => void) | undefined;
        const timer = setTimeout(() => {
          void unlistenOk?.();
          void unlistenFail?.();
          resolve("Update timed out — please try again.");
        }, 120_000);

        onUpdateDownloaded(() => {
          clearTimeout(timer);
          void unlistenOk?.();
          void unlistenFail?.();
          resolve("ok");
        }).then((fn) => (unlistenOk = fn));

        onUpdateFailed((error) => {
          clearTimeout(timer);
          void unlistenOk?.();
          void unlistenFail?.();
          resolve(error);
        }).then((fn) => (unlistenFail = fn));
      });

      // Kick off the download+install on the Rust side.
      await downloadAndInstallUpdate(updateInfo.version);

      // Wait for either success or failure.
      const result = await outcome;

      void unlistenProgress?.();

      if (result !== "ok") {
        setUpdateError(result);
        setDownloadingUpdate(false);
        setInstallingUpdate(false);
        return;
      }

      setInstallingUpdate(true);
      // Tiny pause so the "Installing…" state is visible before the app quits.
      setTimeout(() => {
        try {
          getCurrentWindow().destroy();
        } catch {
          invoke("exit_app").catch(() => {});
        }
      }, 150);
    } catch (err) {
      void unlistenProgress?.();
      setUpdateError(err instanceof Error ? err.message : "Update download failed");
      setDownloadingUpdate(false);
      setInstallingUpdate(false);
    }
  }, [updateInfo, downloadingUpdate]);

  const reportError = useCallback((message: string) => {
    const id = errorSeq.current++;
    setErrors((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setErrors((prev) => prev.filter((e) => e.id !== id));
      errorTimers.current.delete(id);
    }, 4000);
    errorTimers.current.set(id, timer);
  }, []);

  const dismissError = useCallback((id: number) => {
    const timer = errorTimers.current.get(id);
    if (timer) clearTimeout(timer);
    errorTimers.current.delete(id);
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Auto-hide window on blur (click outside) with a grace period so the tray
  // toggle still works — the Rust handler hides/shows before the timer fires.
  useEffect(() => {
    const win = getCurrentWindow();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unlistenBlur: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    win.listen("tauri://blur", () => {
      timeout = setTimeout(() => {
        // User navigated away while augmenting — cancel the in-flight request
        // so it doesn't burn an API call in the background.
        abortRef.current?.abort();
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
      reportError(err instanceof Error && err.message ? err.message : "Couldn't augment the input");
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
    const ok = await writeClipboard(undoState.after);
    if (!ok) {
      reportError("Couldn't copy to clipboard");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [undoState, reportError]);

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
      reportError(err instanceof Error && err.message ? err.message : "Couldn't delete the saved prompt");
    }
  },
  [reportError],
);

  const renameSaved = useCallback(async (id: string, title: string) => {
    try {
      await renamePrompt(id, title);
      setSavedPrompts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title } : p)),
      );
    } catch (err) {
      reportError(err instanceof Error && err.message ? err.message : "Couldn't rename the saved prompt");
    }
  }, [reportError]);

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
      await saveSettings({ ...(settings ?? { api_key: "", model: "", launch_at_login: false, show_dock: false, last_prompt: "" }), api_key: key });
      const list = await fetchFreeModels(key);
      setModels(list);
      setModelCount(list.length);
      setModelsLoaded(true);
      setVerifyStatus("ok");
      const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, show_dock: false, last_prompt: "" }), api_key: key };
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
      const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, show_dock: false, last_prompt: "" }), model: modelId };
      setSettings(next);
      setModelSelect(modelId);
      await saveSettings(next);
    },
    [settings],
  );

  const toggleLaunchAtLogin = useCallback(async () => {
    const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, show_dock: false, last_prompt: "" }), launch_at_login: !launchAtLogin };
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
      reportError(err instanceof Error && err.message ? err.message : "Couldn't update launch-at-login");
    }
  }, [settings, launchAtLogin, reportError]);

  const toggleDockIcon = useCallback(async () => {
    const next = { ...(settings ?? { api_key: "", model: "", launch_at_login: false, show_dock: false, last_prompt: "" }), show_dock: !showDock };
    setShowDock(next.show_dock);
    setSettings(next);
    try {
      await invoke("toggle_dock_icon", { show: next.show_dock });
      await saveSettings(next);
    } catch (err) {
      reportError(err instanceof Error && err.message ? err.message : "Couldn't toggle the Dock icon");
    }
  }, [settings, showDock, reportError]);

  return {
    settings,
    input,
    setInput,
    augmenting,
    canUndo,
    undoState,
    copied,
    errors,
    dismissError,
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
    renameSaved,
    savePanelError,
    setSavePanelError,
    models,
    modelsLoaded,
    modelCount,
    keyInput,
    setKeyInput,
    modelSelect,
    setModelSelect,
    launchAtLogin,
    setLaunchAtLogin,
    showDock,
    toggleDockIcon,
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
    installingUpdate,
    downloadProgress,
    checkUpdate,
    downloadUpdate,
  };
}
