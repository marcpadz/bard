# Bard — Code Audit & Improvement Suggestions

Audit of `bard` v0.4.0 (Tauri 2 + React/Vite frontend, Rust shell). Verified with
`npx tsc --noEmit` (frontend) and `cargo check` (backend) after the fixes below.

## 1. Bugs fixed

### 1.1 `window.alert()` is a silent no-op in Tauri — every error was invisible *(critical)*
Bard renders in a Tauri v2 WKWebView, where `window.alert()`/`confirm()`/`prompt()`
do **not** show native dialogs (WKWebView requires `runJavaScriptAlertPanelWithMessage`
delegates, which Tauri does not wire by default — see *Tauri* GitHub issue tracking
this). The old code used `alert()` as the **only** error path in:

- `augment()` — API/network/empty-result errors
- `copyResult()` — clipboard failures
- `doDeletePrompt()` — delete failures
- `toggleLaunchAtLogin()` — autostart failures

**Result:** when augmentation failed, the window just stopped shimmering with no
explanation. Users assumed it was broken.

**Fix:** added an in-app error toast (`error`/`clearError` via `reportError`,
auto-dismiss after 4s) rendered in `App.tsx`. All four `alert()` calls now route
through `reportError`. Also added a `writeClipboard()` helper with an
`execCommand("copy")` fallback for the case where `navigator.clipboard` is blocked.

Files: `src/hooks/use-app.ts`, `src/lib/api.ts`, `src/App.tsx`, `src/styles.css`

### 1.2 Saved-prompt load errors were swallowed
`refreshSaved()` set `savedError` but `App.tsx` never rendered it. Listed prompts
would silently show "No saved prompts yet" even when the load actually failed.

**Fix:** render `{app.savedError}` in the saved-prompts panel.

### 1.3 "Dock icon toggle" was documented but never wired (*functional gap, not crash*)
README lists a **Dock icon toggle** and the Rust command `toggle_dock_icon` exists,
but there was no UI, no persisted setting, and the dock was unconditionally hidden on
launch. The feature simply didn't exist for the user.

**Fix:** added a `show_dock` field to `Settings` (frontend + Rust, with serde default),
a **Show Dock icon** checkbox in Settings, `toggleDockIcon()` wiring, and launch-time
application in `main.rs` (Accessory policy when off, Regular when on).

Files: `src/hooks/use-app.ts`, `src/lib/api.ts`, `src/App.tsx`, `src-tauri/src/settings.rs`, `src-tauri/src/main.rs`

### 1.4 Stale version reference in README
Install step pointed at `Bard_0.1.0_aarch64.dmg`; current version is `0.4.0`.

**Fix:** updated to `Bard_0.4.0_aarch64.dmg`.

## 2. UI/UX suggestions (not yet implemented)

- **First-run onboarding.** A fresh user sees an empty textarea with no API key.
  Instead of waiting for them to hit Augment and bounce into Settings, show an inline
  hint ("Add a free OpenRouter key in Settings to start") when `settings.api_key` is
  empty.
- **Keyboard shortcuts.** `⌘↵` to augment, `⌘C` to copy, `⌘S` to save, `Esc` to hide —
  natural for a menu-bar power tool. Currently only `Enter` (when saving) works.
- **Editable title for saved prompts.** Saves currently use the first 48 chars of the
  prompt as the title. Let users rename after saving (the `SavedPrompt.title` already
  exists; there's just no rename command/UI).
- **Saved-prompt viewer is read-only with no copy.** The `?promptId=` window only
  renders text. Add a Copy button so the whole point (reuse the prompt) is one click.
- **Accessible focus states.** Inputs rely on colour-only focus rings. Add a visible
  `:focus-visible` outline for keyboard users.
- **Toast queue / multiple errors.** `reportError` replaces the previous message. If
  two errors fire in quick succession only the last shows; consider a small stack if
  this proves annoying.
- **Model picker discoverability.** The free-model dropdown only enables after a
  successful key verify. Show a one-line note ("Verified key → 27 free models") so the
  count is visible.

## 3. Performance & robustness suggestions (not yet implemented)

- **Debounce / cancel stale augmentation.** `completePrompt` runs to completion even
  if the user hides the window. The abort plumbing (`AbortController`) exists but the
  blur auto-hide doesn't cancel an in-flight request. Cancel on window blur if the user
  navigates away.
- **Cache free-model list.** `fetchFreeModels` re-hits OpenRouter on every settings
  open / key verify (and again on mount if a key is stored). Cache the list (and its
  TTL) so re-opening Settings is instant and you save API calls — OpenRouter rate-limits
  free keys.
- **`reqwest::blocking::Client::new()` per call.** `openrouter.rs` builds a brand-new
  blocking client on every `verify_api_key` / `fetch_free_models` / update download.
  Use a single shared `lazy_static`/`OnceLock` client with a connection pool.
- **`current_monitor()` can fail.** `set_window_pos` in `tray.rs` does
  `if let Ok(Some(monitor))` and silently drops the clamp if it errors — on some setups
  the window can spawn off-screen. Fall back to `primary_monitor()`.
- **Stream the augmentation.** `max_tokens: 4000` and a 90s timeout mean long rewrites
  block with only a shimmer. Switching to a streaming completion (SSE) would let the
  text appear progressively and feel far more responsive.
- **Update race on `updateInfo`.** `downloadUpdate` is a `useCallback` depending on
  `updateInfo`; rapid double-clicks could spawn two download threads. Guard with the
  existing `downloadingUpdate` flag before invoking (it's set inside the async, so a
  fast second click slips past). Set a local guard synchronously.
- **Single-instance enforcement.** Two launches open two helper processes; the tray/
  dock logic assumes one. Not critical for a menu-bar app but worth a guard if users
  ever double-click the .app.

## 4. Verification

| Check | Command | Result |
|-------|---------|--------|
| Frontend types | `npx tsc --noEmit` | pass |
| Backend compile | `cargo check` (src-tauri) | pass |

> Note: `cargo build`/full Tauri bundle and a live runtime smoke test were **not**
> performed in this environment (no full toolchain + signing pipeline). The Rust
> change is verified at the `cargo check` level only.
