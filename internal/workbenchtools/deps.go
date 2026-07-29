package workbenchtools

import (
	"WWorkbench/internal/conn"
	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/meta"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/query"
	"WWorkbench/internal/session"
	"WWorkbench/internal/store"
	"WWorkbench/internal/terminal"
)

// Deps 工作台工具依赖（业务服务，非 Wails）。
type Deps struct {
	Conns     *conn.Service
	SSHHosts  *terminal.HostService
	Sessions  *session.Manager
	Meta      *meta.Service
	Queries   *query.Service
	Store     *store.Store
	Notebook  *notebook.Service
	Docker    *dockersvc.Manager
	UIActions *UIActionBus
}
