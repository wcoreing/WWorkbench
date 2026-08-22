package workbenchtools

import (
	"context"

	"WWorkbench/internal/conn"
	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/meta"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
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
	Terminals   *terminal.Manager
	HarnessRoot func() string
	Agent       AgentSync
}
