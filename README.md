# Bard

> A tiny macOS menu bar app that enriches your prompts before you hand them to an AI agent.

Bard takes a rough prompt, runs it through a free OpenRouter model, and returns a rewritten version that is specific, unambiguous, and context-rich — so the agent executing it makes fewer assumptions and delivers what you actually meant.

## Why

The gap between *what you're thinking* and *what you type* is where agents go wrong. Bard closes it: paste your raw intent, get back a prompt the agent can execute without guessing — your scope, constraints, and acceptance criteria preserved, nothing invented.

## Features

- **Menu bar only** — no dock icon; the window anchors under the tray icon
- **Prompt enrichment** — sparkle button lifecycle: shimmer while processing → stop (cancel) → undo → copy
- **Last prompt remembered** — your enriched prompt persists and restores on next launch
- **Auto-hide** — click outside the window and it disappears
- **Draggable window** — grab anywhere that isn't an input and move it
- **Free OpenRouter models** — paste an API key, verify it, and pick any free model
- **Launch at login** — optional toggle in Settings
- **Dock icon toggle** — show or hide the Dock icon from Settings

## Install

1. Download `Bard_0.1.0_aarch64.dmg` from [Releases](../../releases)
2. Open it and drag **Bard.app** into your Applications folder
3. Click the Bard icon in the menu bar to open the window
4. Right-click the icon → **Settings…** → paste your OpenRouter API key → **Save & Verify Key** → pick a free model

> **Note:** The app is unsigned, so macOS may show a Gatekeeper prompt the first time you launch it. Right-click the app in Finder → **Open** to allow it.

## Requirements

- macOS 10.15+
- Apple Silicon (arm64 build)
- An [OpenRouter](https://openrouter.ai) API key (free models only)

## Development

```bash
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # build the .app and .dmg
```

The frontend is React + Vite + TypeScript; the shell is Tauri 2 (Rust).

## Publishing

```bash
./scripts/publish-release.sh 0.2.0
```

This bumps the version, builds the DMG, commits and tags, then creates a GitHub
release with the DMG attached. Users running an older version get a banner in
the app pointing at the new release.

## Updating the app

Bard checks the GitHub releases feed on launch. When a new version is live:

- A banner appears in the main window — **Update** downloads the new DMG into
  `~/Downloads` and opens it for you to drag into Applications.
- Settings → Updates shows the current version, a **Check for Updates** button,
  and the download progress.

## How it works

- The prompt-optimizer meta-prompt is a port of the **Augment Input** feature from Dextop's chat composer — it instructs the model to rewrite for specificity, preserve intent/constraints, and return only the rewritten prompt as plain text.
- Enrichment calls `https://openrouter.ai/api/v1/chat/completions` with a single user message — no tools, plain text out, 90s timeout, abortable.
- Free models are discovered via `GET /api/v1/models` filtered to zero-priced endpoints.
- Settings (API key, model, launch-at-login, last prompt) live in `~/Library/Application Support/com.bard.prompter/settings.json`.

## Project layout

```
├── src/                 # React frontend (window UI, settings panel)
│   ├── App.tsx          # main window + button state machine
│   ├── hooks/use-app.ts # augment lifecycle, settings, auto-hide
│   └── lib/api.ts       # OpenRouter client + optimizer meta-prompt
├── src-tauri/           # Tauri shell (Rust)
│   ├── src/tray.rs      # menu bar icon + window anchoring
│   ├── src/openrouter.rs# key verification + free-model fetch
│   ├── src/settings.rs  # persistence + commands
│   └── icons/           # SVG sources + generated PNG/ICNS
└── package.json         # npm scripts (dev/build/tauri)
```

## License

MIT
