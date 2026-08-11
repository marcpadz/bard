import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bookmark,
  Check,
  Copy,
  Loader2,
  Save,
  Settings2,
  Square,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useApp } from "./hooks/use-app";
import "./styles.css";

/** Sparkles icon — geometry ported from DexTop's augment-input-popover. */
function StarsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M12.5909 1.56333C12.5761 1.43238 12.4654 1.33339 12.3336 1.33325C12.2018 1.33312 12.0909 1.43188 12.0758 1.56281C12.0055 2.17233 11.8245 2.59048 11.5409 2.8741C11.2572 3.15772 10.8391 3.33873 10.2295 3.40903C10.0986 3.42413 9.99987 3.53506 10 3.66685C10.0001 3.79865 10.0991 3.90937 10.2301 3.9242C10.8293 3.99207 11.257 4.17305 11.5478 4.45861C11.8371 4.74263 12.0215 5.16019 12.0751 5.7636C12.087 5.89748 12.1992 6.00007 12.3336 5.99992C12.468 5.99977 12.5801 5.89693 12.5916 5.76302C12.643 5.16981 12.8273 4.74284 13.1184 4.45168C13.4096 4.16053 13.8365 3.97623 14.4297 3.92488C14.5637 3.91329 14.6665 3.80129 14.6667 3.66688C14.6668 3.53247 14.5642 3.42024 14.4303 3.40835C13.8269 3.35475 13.4094 3.1703 13.1253 2.88105C12.8398 2.59022 12.6588 2.16255 12.5909 1.56333Z" />
      <path d="M7.99565 3.25838C7.95752 2.92164 7.67285 2.6671 7.33392 2.66675C6.99505 2.6664 6.70979 2.92036 6.67099 3.25703C6.4902 4.82437 6.02475 5.89961 5.29543 6.62893C4.56612 7.35821 3.49088 7.82368 1.92353 8.00448C1.58687 8.04328 1.33291 8.32855 1.33325 8.66742C1.3336 9.00635 1.58815 9.29101 1.92489 9.32915C3.46573 9.50368 4.56545 9.96908 5.31331 10.7034C6.05709 11.4337 6.53137 12.5074 6.66919 14.0591C6.69979 14.4033 6.98839 14.6671 7.33399 14.6667C7.67965 14.6663 7.96765 14.4019 7.99745 14.0575C8.12945 12.5321 8.60339 11.4343 9.35205 10.6855C10.1008 9.93688 11.1987 9.46295 12.7241 9.33095C13.0684 9.30115 13.329 9.01315 13.3333 8.66748C13.3337 8.32188 13.0699 8.03328 12.7256 8.00268C11.1739 7.86488 10.1003 7.39061 9.36992 6.6468C8.63559 5.89895 8.17019 4.79922 7.99565 3.25838Z" />
    </svg>
  );
}

export default function App() {
  const app = useApp();
  const [saveTitle, setSaveTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // Non-main windows (saved-prompt viewer) load with ?promptId=… — mount with
  // the prompt content so double-clicking a saved prompt opens it in a fresh
  // window without touching the main one.
  const promptId = new URLSearchParams(window.location.search).get("promptId");
  const [viewPrompt, setViewPrompt] = useState<string | null>(promptId);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (!promptId || loadedId.current === promptId) return;
    loadedId.current = promptId;
    invoke<string>("get_prompt_by_id", { id: promptId })
      .then((text) => setViewPrompt(text))
      .catch(() => setViewPrompt(""));
  }, [promptId]);

  const openPromptWindow = useCallback((id: string) => {
    // New window: URL with the id, viewport sized for the prompt, always on
    // top. The existing window is left untouched.
    const label = `prompt-${id}`;
    void WebviewWindow.getByLabel(label)
      .then((existing) => {
        if (existing) {
          existing.show();
          existing.setFocus();
          return;
        }
        return new WebviewWindow(label, {
          url: `index.html?promptId=${encodeURIComponent(id)}`,
          title: "Saved Prompt",
          width: 640,
          height: 520,
          resizable: true,
          decorations: true,
          alwaysOnTop: true,
          center: true,
        });
      })
      .catch(() => {});
  }, []);

  const runSave = useCallback(async () => {
    if (!app.undoState) return;
    setSaving(true);
    const ok = await app.doSavePrompt(saveTitle.trim(), app.undoState.after);
    setSaving(false);
    if (ok) {
      setSaveTitle("");
      app.setSavePanelError("");
      app.setSavedOpen(true);
    }
  }, [app, saveTitle]);

  // Native window drag — grab anywhere that isn't an interactive control.
  const startDrag = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("textarea, input, button, select, a")) return;
    getCurrentWindow().startDragging();
  }, []);

  // Viewer windows: no header/settings — plain read-only text.
  if (viewPrompt !== null) {
    return (
      <div className="viewer">
        <textarea className="viewer-input" readOnly value={viewPrompt} spellCheck={false} />
      </div>
    );
  }

  return (
    <div className="app" onMouseDown={startDrag}>
      {/* Header */}
      <header className="header">
        <span className="logo">
          <Sparkles size={13} />
        </span>
        <span className="title">Bard</span>
        <span className="subtitle">Prompt Enricher</span>
        <div className="header-actions">
          <button
            className="icon-btn"
            title="Saved prompts"
            onClick={() => app.openSaved()}
          >
            <Bookmark size={14} />
          </button>
          <button
            className="icon-btn"
            title="Settings"
            onClick={() => app.setSettingsOpen(true)}
          >
            <Settings2 size={14} />
          </button>
          <button
            className="icon-btn"
            title="Hide Bard"
            onClick={() => getCurrentWindow().hide()}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Update banner */}
      {app.updateAvailable && app.updateInfo && (
        <div className="update-banner">
          <span>Bard {app.updateInfo.version} is available</span>
          <button className="btn primary small" onClick={app.downloadUpdate}>
            Update
          </button>
        </div>
      )}

      {/* Main editor */}
      <main className="main">
        <textarea
          className={`prompt-input${app.augmenting ? " shimmer" : ""}`}
          placeholder="Paste or type the prompt you want to enrich…"
          value={app.input}
          onChange={(e) => app.setInput(e.target.value)}
          spellCheck={false}
          autoFocus
        />

        <div className="actions">
          <div className="spacer" />
          <button
            className="icon-btn augment-btn"
            title={
              app.augmenting
                ? "Augmenting… click to cancel"
                : app.canUndo
                  ? "Undo augmentation"
                  : "Augment input"
            }
            disabled={!app.augmenting && !app.canUndo && app.input.trim().length === 0}
            onClick={() => {
              if (app.augmenting) {
                app.cancel();
              } else if (app.canUndo) {
                app.undo();
              } else {
                app.augment();
              }
            }}
          >
            {app.augmenting ? (
              <Square size={14} fill="currentColor" />
            ) : app.canUndo ? (
              <Undo2 size={15} />
            ) : (
              <StarsIcon size={16} />
            )}
          </button>
          {app.canUndo && !app.augmenting && (
            <>
              <button
                className="icon-btn"
                title="Save prompt"
                onClick={runSave}
              >
                <Save size={14} />
              </button>
              <button
                className="icon-btn"
                title={app.copied ? "Copied!" : "Copy enriched prompt"}
                onClick={app.copyResult}
              >
                {app.copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </>
          )}
        </div>

        {app.augmenting && (
          <div className="status">
            <Loader2 size={12} className="spin" />
            <span>Augmenting…</span>
          </div>
        )}
        {app.canUndo && !app.augmenting && (
          <div className="status done">
            <Check size={12} />
            <span>Prompt enriched</span>
          </div>
        )}
      </main>

      {/* Saved prompts panel */}
      {app.savedOpen && (
        <div className="settings saved-panel">
          <div className="settings-header">
            <span>Saved prompts</span>
            <button className="icon-btn" onClick={app.closeSaved}>
              <X size={13} />
            </button>
          </div>

          <div className="save-row">
            <input
              className="save-title"
              placeholder="Name this prompt…"
              value={saveTitle}
              onChange={(e) => {
                setSaveTitle(e.target.value);
                app.setSavePanelError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) void runSave();
              }}
            />
            <button className="btn primary" disabled={saving || !app.undoState} onClick={runSave}>
              <Save size={12} />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {app.savePanelError && <p className="hint err">{app.savePanelError}</p>}

          {!app.savedLoaded ? (
            <div className="status">
              <Loader2 size={12} className="spin" />
              <span>Loading…</span>
            </div>
          ) : app.savedPrompts.length === 0 ? (
            <p className="hint">No saved prompts yet — enrich something and hit Save.</p>
          ) : (
            <ul className="saved-list">
              {app.savedPrompts.map((p) => (
                <li
                  key={p.id}
                  className="saved-item"
                  title="Double-click to open"
                  onDoubleClick={() => openPromptWindow(p.id)}
                >
                  <span className="saved-title">{p.title || p.text.slice(0, 48)}</span>
                  <button
                    className="icon-btn"
                    title="Delete"
                    onClick={() => app.doDeletePrompt(p.id)}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Settings panel */}
      {app.settingsOpen && (
        <div className="settings">
          <div className="settings-header">
            <span>Settings</span>
            <button className="icon-btn" onClick={() => app.setSettingsOpen(false)}>
              <X size={13} />
            </button>
          </div>

          <label className="field">
            <span className="label">OpenRouter API key</span>
            <input
              type="password"
              placeholder="sk-or-…"
              value={app.keyInput}
              onChange={(e) => {
                app.setKeyInput(e.target.value);
                app.setVerifyStatus("idle");
                app.setVerifyError("");
              }}
            />
          </label>

          <button className="btn primary" disabled={app.verifyStatus === "verifying"} onClick={app.verifyAndFetch}>
            {app.verifyStatus === "verifying" ? "Verifying…" : "Save & Verify Key"}
          </button>
          {app.verifyStatus === "ok" && (
            <p className="hint ok">Key verified — free models loaded.</p>
          )}
          {app.verifyStatus === "error" && (
            <p className="hint err">{app.verifyError || "Couldn't verify the API key"}</p>
          )}

          <label className="field">
            <span className="label">Model</span>
            <select
              value={app.modelSelect}
              disabled={!app.modelsLoaded || app.models.length === 0}
              onChange={(e) => app.saveModel(e.target.value)}
            >
              {app.models.length === 0 ? (
                <option value="">{app.modelsLoaded ? "No free models — verify your key first" : "Loading…"}</option>
              ) : (
                app.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={app.launchAtLogin}
              onChange={app.toggleLaunchAtLogin}
            />
            <span>Launch Bard at login</span>
          </label>

          {/* Updates */}
          <div className="settings-section">
            <span className="label">Updates</span>
            <div className="update-row">
              <span className="version-label">Bard v{app.appVersion || "0.1.0"}</span>
              <button
                className="btn secondary"
                disabled={app.checkingUpdate}
                onClick={() => app.checkUpdate(false)}
              >
                {app.checkingUpdate ? "Checking…" : "Check for Updates"}
              </button>
            </div>
            {app.updateError && <p className="hint err">{app.updateError}</p>}
            {app.updateAvailable && app.updateInfo && (
              <div className="update-available">
                <p className="hint ok">
                  Version {app.updateInfo.version} is available.
                </p>
                <button
                  className="btn primary"
                  disabled={app.downloadingUpdate || app.installingUpdate}
                  onClick={app.downloadUpdate}
                >
                  {app.installingUpdate
                    ? "Installing…"
                    : app.downloadingUpdate
                      ? app.downloadProgress !== null && app.downloadProgress > 0
                        ? `Downloading… ${Math.round(app.downloadProgress)}%`
                        : "Downloading…"
                      : `Update to v${app.updateInfo.version}`}
                </button>
                {app.downloadingUpdate && app.downloadProgress !== null && (
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${Math.min(100, app.downloadProgress)}%` }} />
                  </div>
                )}
              </div>
            )}
            {!app.updateAvailable && !app.updateError && !app.checkingUpdate && (
              <p className="hint ok">Bard is up to date.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
