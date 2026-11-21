package workbenchtools

import (
	"context"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/conn"
	"WWorkbench/internal/desktop"
	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/meta"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/pluginpack"
	"WWorkbench/internal/query"
	"WWorkbench/internal/session"
	"WWorkbench/internal/store"
	"WWorkbench/internal/terminal"
)

// AgentSync MCP / 外置客户端同步对话。
type AgentSync interface {
	ChatSync(ctx context.Context, req model.AgentChatRequestDO) (model.AgentChatSyncResultDO, error)
	ConfirmSync(ctx context.Context, pendingID string, approved bool) (model.AgentChatSyncResultDO, error)
}

// Deps 工作台工具依赖（业务服务，非 Wails）。
type Deps struct {
	Conns       *conn.Service
	SSHHosts    *terminal.HostService
	Sessions    *session.Manager
	Meta        *meta.Service
	Queries     *query.Service
	Store       *store.Store
	Notebook    *notebook.Service
	Docker      *dockersvc.Manager
	UIActions   *UIActionBus
	Radar       *RadarBus
	MCPConfirm  *MCPConfirmGate
	WriteAllows *MCPWriteAllowBook
	TrustOps    *MCPTrustBook
	Episodes    *LearningEpisodeBook
	Terminals   *terminal.Manager
	Browser     *browser.Bridge
	// AgentBrowser 第三执行器（agent-browser CLI）；nil 表示不启用。
	AgentBrowser *browser.AgentBrowserExecutor
	// Desktop 桌面应用驱动（agent-desktop CLI）；DesktopGrants 决定 AI 能读 / 操作哪些应用。
	Desktop       *desktop.Driver
	DesktopGrants *DesktopGrantBook
	HarnessRoot   func() string
	Agent         AgentSync
	PluginPacks   *pluginpack.Manager
}

// EffectivePermissions 用户权限 ∩ pack 启用门控（pack 声明的能力需对应 pack 启用）。
func (d *Deps) EffectivePermissions() map[string]bool {
	if d == nil || d.Store == nil {
		return map[string]bool{}
	}
	base := d.Store.GetToolPermissions()
	if d.PluginPacks == nil {
		return base
	}
	return d.PluginPacks.GatePermissions(base)
}
