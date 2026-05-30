# WWorkbench

**WWorkbench** — an all-in-one local developer workbench: database, terminal, files, containers, runtime environments, and notebooks in a single desktop app.

**English** | [简体中文](README.zh-CN.md)

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v2-DF4C32)](https://wails.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Current version: **v0.24.0** (shown in the bottom-right corner of the app)

---

## Features

| Module | Description |
|--------|-------------|
| **Database** | MySQL connection management, SQL editor & execution, object tree, table data editing, DDL / table design |
| **Terminal** | Local shell, interactive SSH terminal, host trust, split panes |
| **Files (SFTP)** | Remote directory browsing, upload/download, bookmarks, conflict handling, transfer queue |
| **Containers (Docker)** | Local / remote SSH Docker, image & container management, logs & env vars, run from image, one-click DB connect |
| **Environment (Env)** | Install, switch, and preset local Node / Go / PHP / Java versions |
| **Notebook** | Ops notes, Markdown editing & preview |

Additional capabilities:

- Dark / light theme with preferences persisted to local SQLite
- UI language: **English / 简体中文** (switch via the globe icon in the top bar)
- Multi-product workspace state auto-restore

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Wails v2](https://wails.io/) |
| Backend | Go 1.25+ |
| Frontend | React 18, TypeScript, Vite, Zustand |
| Editors | Monaco Editor, xterm.js |
| Storage | SQLite (`modernc.org/sqlite`) |
| Integrations | Docker Engine API, SSH/SFTP, MySQL |

---

## Prerequisites

Before developing or building from source:

| Dependency | Notes |
|------------|-------|
| **Go** | ≥ 1.25 |
| **Node.js** | ≥ 18 (LTS recommended) |
| **Wails CLI** | v2.12+, see [Wails docs](https://wails.io/docs/gettingstarted/installation) |
| **Platform toolchain** | macOS: Xcode CLT; Windows: WebView2 + build tools |

Optional (feature-dependent):

- **Docker Desktop** or local `docker.sock` — container module
- **Homebrew / nvm / goenv, etc.** — environment module version management

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/wcoreing/WWorkbench.git
cd WWorkbench
```

### 2. Install dependencies

```bash
# Frontend dependencies
cd frontend && npm install && cd ..

# Go dependencies (from project root)
go mod download
```

### 3. Development mode (hot reload)

```bash
wails dev
```

Optional browser debugging: open `http://localhost:34115` while dev server is running.

### 4. Production build

```bash
wails build
```

Artifacts are written to `build/bin/`:

- macOS: `WNavicat.app` or `WNavicat`
- Windows: `WNavicat.exe`

### 5. Regenerate Wails frontend bindings

After changing exported methods in the Go `app` layer:

```bash
wails generate module
```

---

## Project Structure

```
WWorkbench/
├── main.go                 # Application entry
├── version.go              # Version number (bump before release)
├── internal/
│   ├── app/                # Wails API layer
│   ├── adapter/            # Database driver adapters (MySQL)
│   ├── conn/               # Connections & sessions
│   ├── docker/             # Docker management
│   ├── environment/        # Local runtime versions
│   ├── notebook/           # Notebook
│   ├── sftp/               # SFTP
│   ├── store/              # SQLite & configuration
│   └── terminal/           # Terminal & SSH
├── frontend/
│   ├── src/
│   │   ├── products/       # Product workbenches
│   │   ├── features/       # Feature components
│   │   ├── i18n/           # zh / en strings
│   │   └── shell/          # App shell & navigation
│   └── wailsjs/            # Wails auto-generated bindings
└── build/                  # Platform packaging assets
```

---

## Data & Configuration

Application data is stored under the user home directory and is **never** committed to the repo:

| Path | Contents |
|------|----------|
| `~/.wnavicat/` | SQLite database, SSH known_hosts, workspace snapshots, etc. |

Passwords and other secrets are stored only in the local database. Do not attach `~/.wnavicat` to issues or commits.

---

## Internationalization (i18n)

- String files: `frontend/src/i18n/locales/zh.ts`, `en.ts`
- In components: `const { t } = useI18n()` → `t('common.save')`
- Preference key: `locale` (`zh` | `en`), stored in SQLite `app_settings`

Modules not yet migrated to i18n may still show Chinese; follow the Docker module as a reference when adding translations.

---

## Publishing to GitHub

### First push

```bash
cd WWorkbench

# Initialize Git (if not already done)
git init

# Ensure .gitignore is effective (no node_modules, build/bin, local DB, etc.)
git status

git add .
git commit -m "chore: initial open source release"

# After creating an empty repo on GitHub (do not add a README to avoid conflicts)
git branch -M main
git remote add origin https://github.com/wcoreing/WWorkbench.git
git push -u origin main
```

### Release checklist

1. Update `AppVersion` in `version.go`
2. Commit and tag:

```bash
git commit -am "chore: release v0.22.2"
git tag v0.22.2
git push origin main --tags
```

3. Create a GitHub **Release** from the tag and upload `wails build` artifacts (`.app` / `.exe`)

### Pre-push checklist

- [ ] No `.env`, API keys, passwords, or private keys in the repo
- [ ] No `frontend/node_modules`, `build/bin`, or other large directories
- [ ] `LICENSE` is present (MIT for this project)
- [ ] Repository URL in `README.md` points to your GitHub org/user
- [ ] Optional: add screenshots under `docs/images/` and link them in the README

### Branching (optional)

```bash
git checkout -b feature/xxx    # feature work
git checkout -b fix/xxx        # bug fixes
# Open a Pull Request to main when done
```

---

## Contributing

Issues and Pull Requests are welcome. Before submitting:

1. Ensure `go build .` and `cd frontend && npm run build` pass
2. Follow existing directory and naming conventions (Go models use `*DO` suffix, etc.)
3. Update both `zh.ts` and `en.ts` for user-visible strings
4. Bump the version in `version.go` for feature changes

---

## License

This project is open source under the [MIT License](LICENSE).

---

## Acknowledgements

- [Wails](https://wails.io/) — Go + web desktop app framework
- [Navicat](https://www.navicat.com/) — UI/UX inspiration (this is an independent open-source project, not affiliated with Navicat)
