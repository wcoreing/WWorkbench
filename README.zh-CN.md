# WWorkbench

**WWorkbench** — 面向开发者的本地一体化工作台：数据库、终端、文件、容器、运行时环境与笔记本，集成在一个桌面应用中。

[English](README.md) | **简体中文**

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v2-DF4C32)](https://wails.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 当前版本：**v0.28.0**（界面右下角可查看）

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **数据库** | MySQL / PostgreSQL / Redis 连接、SQL 或命令控制台、对象树、表/键数据、DDL / 表设计（MySQL） |
| **终端** | 本机 Shell、SSH 交互终端、主机信任与分屏 |
| **文件 (SFTP)** | 远程目录浏览、上传下载、书签、冲突处理与传输队列 |
| **容器 (Docker)** | 本地 / SSH 远程 Docker、镜像与容器管理、日志与环境变量、从镜像运行、数据库一键连接 |
| **环境 (Env)** | Node / Go / PHP / Java 本机版本安装、切换与项目预设 |
| **笔记本** | 运维速记、Markdown 编辑与预览 |
| **API** | HTTP 请求调试与响应查看 |
| **日志** | 本机、SSH、Docker 与 Compose 日志查看，支持实时跟随 |

其他特性：

- 深色 / 浅色主题，偏好持久化到本地 SQLite
- 界面语言：**简体中文 / English**（顶栏地球图标切换）
- 多产品线工作区状态自动恢复

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | [Wails v2](https://wails.io/) |
| 后端 | Go 1.25+ |
| 前端 | React 18、TypeScript、Vite、Zustand |
| 编辑器 | Monaco Editor、xterm.js |
| 存储 | SQLite（`modernc.org/sqlite`） |
| 集成 | Docker Engine API、SSH/SFTP、MySQL / PostgreSQL / Redis |

---

## 环境要求

开发或自行编译前，请准备：

| 依赖 | 说明 |
|------|------|
| **Go** | ≥ 1.25 |
| **Node.js** | ≥ 18（推荐 LTS） |
| **Wails CLI** | v2.12+，安装见 [Wails 文档](https://wails.io/docs/gettingstarted/installation) |
| **平台工具链** | macOS：Xcode CLT；Windows：WebView2 + 构建工具 |

可选（按功能使用）：

- **Docker Desktop** 或本机 `docker.sock` — 容器模块
- **Homebrew / nvm / goenv 等** — 环境模块版本管理

---

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/wcoreing/WWorkbench.git
cd WWorkbench
```

### 2. 安装依赖

```bash
# 前端依赖
cd frontend && npm install && cd ..

# Go 依赖（在项目根目录）
go mod download
```

### 3. 开发模式（热更新）

```bash
wails dev
```

浏览器调试（可选）：开发时另开 `http://localhost:34115`。

### 4. 生产构建

```bash
wails build
```

产物默认在 `build/bin/`：

- macOS：`WNavicat.app` 或 `WNavicat`
- Windows：`WNavicat.exe`

### 5. 生成 Wails 前端绑定

修改 Go 侧 `app` 导出方法后执行：

```bash
wails generate module
```

---

## 项目结构

```
WWorkbench/
├── main.go                 # 应用入口
├── version.go              # 版本号（发布前递增）
├── internal/
│   ├── app/                # Wails API 层
│   ├── adapter/            # 数据库驱动适配（MySQL）
│   ├── conn/               # 连接与会话
│   ├── docker/             # Docker 管理
│   ├── environment/        # 本机运行时版本
│   ├── notebook/           # 笔记本
│   ├── sftp/               # SFTP
│   ├── store/              # SQLite 与配置
│   └── terminal/           # 终端与 SSH
├── frontend/
│   ├── src/
│   │   ├── products/       # 各产品线工作区
│   │   ├── features/       # 功能组件
│   │   ├── i18n/           # 中英文文案
│   │   └── shell/          # 应用壳与导航
│   └── wailsjs/            # Wails 自动生成绑定
└── build/                  # 平台打包资源
```

---

## 数据与配置

应用数据保存在用户目录，**不会**写入仓库：

| 路径 | 内容 |
|------|------|
| `~/.wnavicat/` | SQLite 数据库、SSH known_hosts、工作区快照等 |

连接密码等敏感信息仅存于本地数据库，请勿将 `~/.wnavicat` 打包进仓库或 Issue。

---

## 国际化 (i18n)

- 文案目录：`frontend/src/i18n/locales/zh.ts`、`en.ts`
- 组件内使用：`const { t } = useI18n()` → `t('common.save')`
- 语言偏好键：`locale`（`zh` | `en`），存入 SQLite `app_settings`

尚未接入 i18n 的模块会暂时显示中文，可按 Docker 模块方式逐步迁移。

---

## 发布到 GitHub（开源清单）

### 首次推送

```bash
cd WWorkbench

# 初始化 Git（若尚未初始化）
git init

# 确认 .gitignore 已生效（勿提交 node_modules、build/bin、本地数据库等）
git status

git add .
git commit -m "chore: initial open source release"

# 在 GitHub 创建空仓库后（不要勾选 README，避免冲突）
git branch -M main
git remote add origin https://github.com/wcoreing/WWorkbench.git
git push -u origin main
```

### 版本发布建议

1. 在 `version.go` 中更新 `AppVersion`
2. 提交并打标签：

```bash
git commit -am "chore: release v0.22.2"
git tag v0.22.2
git push origin main --tags
```

3. 在 GitHub **Releases** 页基于 tag 创建 Release，上传 `wails build` 产物（`.app` / `.exe`）

### 推送前自检

- [ ] 仓库内无 `.env`、API Key、密码、私钥
- [ ] 无 `frontend/node_modules`、`build/bin` 等大目录
- [ ] 已添加 `LICENSE`（本项目为 MIT）
- [ ] `README.md` 中仓库地址已替换为你的 GitHub 用户名
- [ ] 可选：添加项目截图到 `docs/images/` 并在 README 引用

### 协作分支（可选）

```bash
git checkout -b feature/xxx    # 功能开发
git checkout -b fix/xxx        # 缺陷修复
# 完成后提 Pull Request 到 main
```

---

## 参与贡献

欢迎 Issue 与 Pull Request。提交前请：

1. 确保 `go build .` 与 `cd frontend && npm run build` 通过
2. 遵循现有目录与命名习惯（Go 模型 `*DO` 后缀等）
3. 用户可见文案请同步更新 `zh.ts` / `en.ts`
4. 功能变更请递增 `version.go` 中的版本号

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

## 致谢

- [Wails](https://wails.io/) — Go + Web 桌面应用框架
- [Navicat](https://www.navicat.com/) — 产品交互灵感来源（本项目为独立开源实现，与 Navicat 官方无关）
