# WWorkbench

**WWorkbench** — a local multi-host ops & development workbench.

The sidebar assistant can see the host and shell you are looking at — **it helps you finish the work; it does not replace you clicking through it**.

**English** | [简体中文](README.zh-CN.md) · [Website](http://wworkbench.wcore.top)

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v2-DF4C32)](https://wails.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/wcoreing/WWorkbench)](https://github.com/wcoreing/WWorkbench/releases/latest)

> Current version: **v0.54.130** (shown in the bottom-right corner of the app)

### Download (unzip and run)

| Platform | Package |
|----------|---------|
| **macOS** (Apple Silicon) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-darwin-arm64.zip` |
| **Windows** (x64) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-windows-amd64.zip` |
| **Linux** (x64) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-linux-amd64.zip` |

Direct links also on the site: [wworkbench.wcore.top](http://wworkbench.wcore.top/#download)

**Privacy**: connections, secrets, and preferences stay in local `~/.wworkbench` (SQLite). No mandatory cloud account. Agent / MCP are optional; disabled capabilities are refused.

---

## Who it's for

- **Multi-host ops**: SSH + Docker + logs + DB belong in one incident workflow
- **Full-stack / self-hosted**: local and remote assets in one restorable workspace
- **Cursor power users**: local MCP lets the editor's AI read ~100 lines of the shell you are watching

| Usual setup | WWorkbench |
|-------------|------------|
| Termius + DBeaver + Docker Desktop + notes in separate apps | One desk, shared assets |
| AI guesses which host you are on | `@` bind hosts/DBs/containers; MCP reads live context |

Recording scripts: [docs/demo-scripts.md](docs/demo-scripts.md).

---

## 5-minute start

1. Download the zip for your OS from Releases and open the app.
2. Open **Terminal**: local shell, or add an SSH host.
3. Open **Notebook**: write one line about what you are doing.
4. (Optional) Sidebar Ask: “what is the current terminal doing?” — check that context is right.
5. (Optional) Wire Cursor — see MCP below.

---

## Cursor via MCP

1. Start WWorkbench; in assistant settings, keep **MCP HTTP** on (default `127.0.0.1:51021`).
2. Copy the **Workbench URL** (must be `/mcp/workbench`, not `/mcp`).
3. Add to Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "wworkbench": {
      "url": "http://127.0.0.1:51021/mcp/workbench"
    }
  }
}
```

Writes may return `ww_confirm` text — confirm in the **WWorkbench sidebar**. External clients do not click confirm for you.

---

## Features

| Module | Description |
|--------|-------------|
| **Database** | MySQL / PostgreSQL / SQLite / Redis — SQL or command console, table/key browser, DDL / design (MySQL) |
| **Terminal** | Local shell, interactive SSH, host assets, split panes, **SSH local port forwards** |
| **Files (SFTP)** | Remote directory browsing, upload/download, bookmarks, conflict handling, transfer queue |
| **Containers (Docker)** | Local / remote SSH Docker, image & container management, logs & env vars, run from image, one-click DB connect |
| **Environment (Env)** | Install, switch, and preset local Node / Go / PHP / Java versions |
| **Notebook** | Ops notes, Markdown editing & preview, groups & templates, bind SSH / database assets |
| **API** | HTTP requests, environments, folders, and response viewer |
| **Logs** | Local, SSH, Docker and Compose log viewer with live follow |
| **Assistant** | Ask / Plan / Agent modes; `@` bind hosts/DBs/containers; writes confirm. Visible mutations go to the terminal pane; headless probes are read-only |

Additional:

- Dark / light theme with preferences in local SQLite
- UI language: **English / 简体中文** (globe icon in the top bar)
- Multi-product workspace restore; asset radar refreshes the UI after saves
- Capability switches: disabled AI tools are refused

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Wails v2](https://wails.io/) |
| Backend | Go 1.25+ |
| Frontend | React 18, TypeScript, Vite, Zustand |
| Editors | Monaco Editor, xterm.js |
| Storage | SQLite (`modernc.org/sqlite`) |
| Integrations | Docker Engine API, SSH/SFTP, MySQL / PostgreSQL / Redis |

---

## Develop from source

### Prerequisites

| Dependency | Notes |
|------------|-------|
| **Go** | ≥ 1.25 |
| **Node.js** | ≥ 18 (LTS recommended) |
| **Wails CLI** | v2.12+, see [Wails docs](https://wails.io/docs/gettingstarted/installation) |
| **Platform toolchain** | macOS: Xcode CLT; Windows: WebView2 + build tools |

Optional: Docker Desktop / `docker.sock`; Homebrew / nvm / goenv (Env module).

### Clone and run

```bash
git clone https://github.com/wcoreing/WWorkbench.git
cd WWorkbench
cd frontend && npm install && cd ..
go mod download
wails dev
```

Optional browser debug: `http://localhost:34115`.

```bash
wails build            # output under build/bin/
wails generate module  # after changing Go-exported APIs
```

---

## Project layout

```
WWorkbench/
├── main.go
├── version.go
├── internal/          # app, adapters, docker, notebook, sftp, store, terminal, …
├── frontend/          # React products / features / i18n / shell
└── build/             # packaging assets
```

---

## Data & config

| Path | Contents |
|------|----------|
| `~/.wworkbench/` | SQLite DB, SSH known_hosts, workspace snapshots |

Do not commit or attach `~/.wworkbench` to issues.

---

## i18n

- Locales: `frontend/src/i18n/locales/zh.ts`, `en.ts`
- Usage: `const { t } = useI18n()` → `t('common.save')`
- Preference key `locale` (`zh` | `en`) in SQLite `app_settings`

---

## Releases

1. Bump `AppVersion` in `version.go`
2. Tag and upload darwin-arm64 / windows-amd64 / linux-amd64 zips on GitHub Releases
3. Ensure no secrets, no `node_modules` / `build/bin` in the repo

---

## Contributing

PRs welcome. Before submit:

1. `go build .` and `cd frontend && npm run build` pass
2. Follow existing layout and naming
3. Sync user-facing strings in `zh.ts` / `en.ts`
4. Bump `version.go` for functional changes

---

## Community

WeChat (**韦宁**, Nanning, Guangxi) — see QR in [README.zh-CN.md](README.zh-CN.md).

[GitHub Issues](https://github.com/wcoreing/WWorkbench/issues)

---

## License

[MIT License](LICENSE)

## Acknowledgements

- [Wails](https://wails.io/) — Go + Web desktop framework
