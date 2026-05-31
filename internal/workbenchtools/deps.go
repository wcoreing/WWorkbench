package workbenchtools

import (
	"WNavicat/internal/conn"
	"WNavicat/internal/meta"
	"WNavicat/internal/query"
	"WNavicat/internal/session"
	"WNavicat/internal/store"
	"WNavicat/internal/terminal"
)

// Deps 工作台工具依赖（业务服务，非 Wails）。
type Deps struct {
	Conns     *conn.Service
	SSHHosts  *terminal.HostService
	Sessions  *session.Manager
	Meta      *meta.Service
	Queries   *query.Service
	Store     *store.Store
	UIActions *UIActionBus
}
