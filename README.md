# Agent Smith — Small-Model Code Agent (v46.11.0)

A local-first **coding agent** for small models (7B–35B Gemma/Qwen via LM Studio). Three modes: **Chat** (conversation only), **Agent** (full host control — shell + whole-host files + process management), and **Code Mode** (auto-run build loop with ledger-backed **Revert All**).

**Doctrine:** [`SMITH.md`](SMITH.md) · **Code Mode:** [`docs/CODE_MODE.md`](docs/CODE_MODE.md) · **Navigation:** [`AGENTS.md`](AGENTS.md) · **Protocol:** [`PROTOCOL.md`](PROTOCOL.md)

## What it does

1. **Code Mode** — describe a task; tools run automatically (read, patch, shell, grep).
2. **Trust** — every edit snapshotted; review unified diff; **Revert All** restores pre-run state.
3. **Chat** — ordinary LLM conversation when Code Mode is off.

## Quick start

**Easiest — works on Linux, macOS, and Windows (handles install for you):**

```bash
# Linux / macOS
bash run.sh
```
```bat
:: Windows (or just double-click run.cmd)
run.cmd
```

The launcher installs dependencies **for the current machine** on first run — and if you
copied the project from another OS, it detects the mismatch and reinstalls automatically.
So you can zip the whole folder and run it on either OS without manual fixes.

**Manual equivalent:**

```bash
npm install
npm start
```

1. Load a model in **LM Studio** at `http://localhost:1234`
2. Set workspace via **📍 Here I am**
3. Enable **CODE MODE** in the sidebar
4. Describe a coding task → watch tool activity in the chat timeline
5. Review diff; revert if needed

Headless smoke: `node scripts/code-smoke.js` · greenfield gate: `node scripts/greenfield-smoke.js`

## Sharing with someone on another OS

**Do not zip and send `node_modules`.** `esbuild` and `electron` ship platform-native
binaries, so a `node_modules` built on Windows will not run on Linux/macOS (the renderer
build fails with a cryptic "esbuild installed for another platform" error and the app
won't start). Send the **source only** and have the recipient run, on their own machine:

```bash
npm install          # installs the binaries for THEIR platform
npm start
```

To ship an installable Linux build, build it **on Linux** (electron-builder does not
cross-compile cleanly from Windows):

```bash
npm install
npm run dist         # → AppImage + .deb in release/
npm run install-desktop   # optional: app-menu launcher + correct taskbar icon on Linux
```

`npm run dist` requires `author` in `package.json` (used for the `.deb` maintainer field).

The desktop app uses a **frameless** window with custom minimize/maximize/close controls on the top-right.

### Why Linux installs used to fail

The core app has **no native build steps** — `bcryptjs`, `fast-glob`, `marked`, etc. are
pure JS, and `esbuild`/`electron` ship prebuilt binaries for every platform. The thing
that broke `npm install` on Linux was the **optional** WhatsApp feature: `whatsapp-web.js`
pulls in **puppeteer**, whose postinstall downloads ~150 MB of Chromium and needs Linux
system libraries (`libgbm`, `libnss3`, …). That is now an **optional dependency**, so a
normal install no longer pulls it and can't fail on it:

```bash
npm install                 # lean, no Chromium — works on a clean Linux box
# WhatsApp linking is opt-in (needs Chromium + system libs):
npm install whatsapp-web.js qrcode
```

If you want to be certain optional deps are skipped (e.g. CI), use `npm install --omit=optional`.

## Operating modes

| Mode | Toggle | Use for |
|------|--------|---------|
| **Chat** | Both off | Q&A, conversation (no tools) |
| **Agent** | AGENT on | Full host control in chat — shell, whole-host file read/write/delete, process management, and web search/fetch (read-only). Catastrophic targets guarded by `pathPolicy`/`commandPolicy` |
| **Code** | CODE MODE on | Auto-run **build** tools on your project (write, patch, ledger) |

Agent and Code are **mutually exclusive** — enabling one disables the other.

## What Agent Mode can do

Agent Mode acts on your behalf across your computer and the web:

- **Whole-host control** — run shell commands, manage processes, and read/write/delete files anywhere (not just the project), with `pathPolicy`/`commandPolicy` refusing catastrophic targets.
- **Web read** — `web_search` to search the internet and `fetch_url` to read a page or API as text (read-only; no interactive browsing).
- **Trust layer** — every consequential action is logged; reversible ones (file writes/deletes) can be undone by asking the agent to `review_actions` / `undo_action`.

> **Model tip:** Agent/Chat both need a model served by LM Studio. If LM Studio uses Just‑In‑Time loading, the model list can be empty; pick your model once in the dropdown and the app remembers it.

## Highlights

- **Code loop** — `src/code/` multi-tool turns, extractor, budget, early stop
- **Gemma harness** — system folding, tool JSON preamble
- **Edit engine** — patch-first; ledger snapshots before every write
- **Completion gate** — syntax + truncation checks before a run can finish; immediate warnings on write
- **Plugin system** — extend chat hooks/commands ([`docs/PLUGINS.md`](docs/PLUGINS.md))
- **Mobile web UI** — LAN access; optional Cloudflare tunnel. The 📱 button in the composer shows a scannable QR (REMOTE/LAN badge) to open Agent Smith on your phone
- **Runtime auto-tune** — model-aware context/temperature profiles, on by default; manual sliders under **ADVANCED → TUNING** only when Auto-tune is off ([`docs/RUNTIME_PROFILE.md`](docs/RUNTIME_PROFILE.md))
- **Zero-setup cockpit** — Build Mode always plans then grinds to green; an always-visible compact Hardware Guard shows live RAM/VRAM/GPU with a one-click GPU reset
- **Trust layer** — Agent Mode records file writes/deletes to an audit log you can review and undo
- **Frameless desktop** — edge-to-edge UI with custom window controls; official taskbar icon via `npm run install-desktop` (Linux)

### Removed in v46.11 (migrating from older docs)

Interactive **live browser automation**, the **Credential Vault**, and **persistent chat watchers** are gone (and their `browser_*` / `vault_*` / `watch_chat_*` tools). Still supported: Code Mode **`browser_verify`** (headless HTML check), **`show_preview`**, Agent **`web_search` / `fetch_url`**, and optional **WhatsApp** linking. See [`CHANGELOG.md`](CHANGELOG.md) (v46.11.0).

## Project layout

Electron keeps a thin **shell at the repo root**; application code lives under `src/`:

| Location | Contents |
|----------|----------|
| **Root** | `main.js`, `preload.js`, `index.html`, `icon.png` — Electron entry + HTML shell |
| **`src/renderer/`** | UI modules, `app.js` (DOM wiring), `styles/`, esbuild entry → `dist/renderer/bundle.js` |
| **`src/main/`** | Main-process services + IPC handlers |
| **`src/code/`** | Code Mode engine (orchestrator, tools, completion gate) |
| **`src/shared/`** | Cross-process helpers (IPC channels, command policy, persona) |
| **`tests/`** | Unit/integration tests |
| **`docs/`** | Architecture, Code Mode, plugins, harness notes |

Legacy session paths may still use the **xkaliber** prefix in app data (previous product name); that is intentional for upgrade compatibility.

## Verification

```bash
npm test
npm run ship-check
node scripts/verify-main-ipc.js
npm run build:renderer
```

## Key paths

| Path | Role |
|------|------|
| `src/code/loop/runCodeTask.js` | Code Mode orchestrator |
| `src/code/tools/executor.js` | Tool dispatch + ledger |
| `src/main/ipc/code.js` | `code-run`, `code-stop`, `code-event` |
| `src/main/services/changeLedger.js` | Snapshots + revert |
| `src/renderer/app.js` | DOM shell: auth, chat, mode toggles, sidebar |
| `src/renderer/styles/base.css` | Matrix terminal theme |
| `src/renderer/styles/overlay.css` | Card-based UI overlay |
| `src/renderer/modes/` | Chat/Code mode isolation |
| `scripts/` | Build, ship-check, IPC verify, standalone server |
| `docs/` | Architecture, Code Mode, plugins |
| `tests/` | Unit/integration tests (`npm test`) |
| `dist/renderer/bundle.js` | Generated renderer bundle (do not edit by hand) |
