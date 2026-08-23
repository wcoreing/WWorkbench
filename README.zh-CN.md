# WWorkbench

**WWorkbench** — 本地多主机运维与开发工作台。

侧栏助手能看见你正在看的机器与终端，帮你查、写、落盘——**引导你把事做完，而不是替你点完**。

[English](README.md) | **简体中文** · [官网](http://wworkbench.wcore.top)

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v2-DF4C32)](https://wails.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/wcoreing/WWorkbench)](https://github.com/wcoreing/WWorkbench/releases/latest)

> 当前版本：**v0.54.138**（界面右下角可查看）

### 下载（解压即用）

| 平台 | 安装包 |
|------|--------|
| **macOS** (Apple Silicon) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-darwin-arm64.zip` |
| **Windows** (x64) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-windows-amd64.zip` |
| **Linux** (x64) | [Releases](https://github.com/wcoreing/WWorkbench/releases/latest) → `*-linux-amd64.zip` |

官网也可直链下载：[wworkbench.wcore.top](http://wworkbench.wcore.top/#download)

**隐私**：连接、密钥与偏好只写本机 `~/.wworkbench`（SQLite），无强制云账号。Agent / MCP 可选；关闭的能力不会被调用。

---

## 适合谁

- **多机运维**：SSH + Docker + 日志 + 库，一次事故里本来就串在一起
- **全栈 / 自托管**：本机与远程资产放进同一工作区，状态可恢复
- **Cursor 重度用户**：本机 MCP 让编辑器里的 AI 读到你正在看的 Shell（约最近 100 行）

| 常见现状 | WWorkbench |
|----------|------------|
| Termius + DBeaver + Docker Desktop + 记事本各开一窗 | 一张台，资产贯通 |
| AI 瞎猜你在哪台机器、终端刚跑了什么 | `@` 绑定主机/库/容器；MCP 可读当前上下文 |

录制传播素材见 [docs/demo-scripts.md](docs/demo-scripts.md)。

---

## 5 分钟上手

1. 从 Releases 下载对应平台 zip，解压打开。
2. 打开 **终端**：本机 Shell，或添加一台 SSH 主机连上。
3. 打开 **笔记本**：记一行「今天在做什么」。
4. （可选）侧栏助手选 Ask：问「当前终端在干什么」——先看它是否读对了上下文。
5. （可选）接 Cursor：见下一节 MCP。

---

## 接上 Cursor（MCP）

1. 启动 WWorkbench；侧栏助手设置里确认 **MCP HTTP** 已开启（默认 `127.0.0.1:51021`）。
2. 复制 **工作台 URL**（须为 `/mcp/workbench`，不要用 `/mcp`）。
3. 在 Cursor 的 `mcp.json` 中加入：

```json
{
  "mcpServers": {
    "wworkbench": {
      "url": "http://127.0.0.1:51021/mcp/workbench"
    }
  }
}
```

写操作可能返回含 `ww_confirm` 的提示，需在 **WWorkbench 侧栏**确认；外置客户端不会替你点确认。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **数据库** | MySQL / PostgreSQL / SQLite / Redis：SQL 或命令控制台、对象树、表/键数据、DDL / 表设计（MySQL） |
| **终端** | 本机 Shell、SSH 交互终端、主机资产、分屏；**SSH 本地端口转发**（隧道） |
| **文件 (SFTP)** | 远程目录浏览、上传下载、书签、冲突处理与传输队列 |
| **容器 (Docker)** | 本地 / SSH 远程 Docker、镜像与容器管理、日志与环境变量、从镜像运行、数据库一键连接 |
| **环境 (Env)** | Node / Go / PHP / Java 本机版本安装、切换与项目预设 |
| **笔记本** | 运维速记、Markdown 编辑与预览、分组与模板、关联 SSH / 数据库资产 |
| **API** | HTTP 请求、环境变量、目录与响应查看 |
| **日志** | 本机、SSH、Docker 与 Compose 日志查看，支持实时跟随 |
| **助手** | Ask / Plan / Agent 三模式；`@` 绑定主机/库/容器；写操作确认。看得见的改机走终端面板，无头只读探针另开会话 |

其他特性：

- 深色 / 浅色主题，偏好持久化到本地 SQLite
- 界面语言：**简体中文 / English**（顶栏地球图标切换）
- 多产品线工作区状态自动恢复；资产落盘后界面雷达刷新
- 能力权限开关：关闭的 AI 工具不会被调用

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

## 从源码开发

### 环境要求

| 依赖 | 说明 |
|------|------|
| **Go** | ≥ 1.25 |
| **Node.js** | ≥ 18（推荐 LTS） |
| **Wails CLI** | v2.12+，安装见 [Wails 文档](https://wails.io/docs/gettingstarted/installation) |
| **平台工具链** | macOS：Xcode CLT；Windows：WebView2 + 构建工具 |

可选：Docker Desktop / 本机 `docker.sock`；Homebrew / nvm / goenv 等（环境模块）。

### 克隆与运行

```bash
git clone https://github.com/wcoreing/WWorkbench.git
cd WWorkbench
cd frontend && npm install && cd ..
go mod download
wails dev
```

浏览器调试（可选）：开发时另开 `http://localhost:34115`。

```bash
wails build          # 产物在 build/bin/
wails generate module  # 修改 Go 导出 API 后生成前端绑定
```

---

## 项目结构

```
WWorkbench/
├── main.go                 # 应用入口
├── version.go              # 版本号（发布前递增）
├── internal/
│   ├── app/                # Wails API 层
│   ├── adapter/            # 数据库适配（MySQL / PostgreSQL / SQLite / Redis）
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

| 路径 | 内容 |
|------|------|
| `~/.wworkbench/` | SQLite 数据库、SSH known_hosts、工作区快照等 |

连接密码等敏感信息仅存于本地数据库，请勿将 `~/.wworkbench` 打包进仓库或 Issue。

---

## 国际化 (i18n)

- 文案目录：`frontend/src/i18n/locales/zh.ts`、`en.ts`
- 组件内使用：`const { t } = useI18n()` → `t('common.save')`
- 语言偏好键：`locale`（`zh` | `en`），存入 SQLite `app_settings`

---

## 版本发布

1. 更新 `version.go` 中的 `AppVersion`（与 `internal/mcpserver.ServerVersion` 保持一致若有单独常量）
2. 提交并打 tag，在 GitHub Releases 上传 `wails build` 产物（darwin-arm64 / windows-amd64 / linux-amd64）
3. 推送前确认：无密钥、无 `node_modules` / `build/bin`、MIT LICENSE 在仓

---

## 参与贡献

欢迎 Issue 与 Pull Request。提交前请：

1. 确保 `go build .` 与 `cd frontend && npm run build` 通过
2. 遵循现有目录与命名习惯
3. 用户可见文案请同步更新 `zh.ts` / `en.ts`
4. 功能变更请递增 `version.go` 中的版本号

---

## 交流

使用问题、功能建议或一起打磨工作台，扫码加微信 **韦宁**（广西 南宁）：

<img src="docs/images/wechat.jpg" alt="微信：韦宁" width="220" />

也欢迎 [GitHub Issues](https://github.com/wcoreing/WWorkbench/issues)。

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 致谢

- [Wails](https://wails.io/) — Go + Web 桌面应用框架
