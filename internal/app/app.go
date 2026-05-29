package app

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"strings"

	"WNavicat/internal/conn"
	"WNavicat/internal/data"
	"WNavicat/internal/meta"
	"WNavicat/internal/model"
	"WNavicat/internal/query"
	"WNavicat/internal/session"
	sftpsvc "WNavicat/internal/sftp"
	"WNavicat/internal/store"
	"WNavicat/internal/terminal"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Service Wails 绑定服务。
type Service struct {
	ctx       context.Context
	version   string
	store     *store.Store
	conns     *conn.Service
	sshHosts  *terminal.HostService
	terminals *terminal.Manager
	sftp      *sftpsvc.Manager
	sessions  *session.Manager
	meta      *meta.Service
	queries   *query.Service
	table     *data.Service
}

// NewService 创建应用服务。
func NewService(
	version string,
	st *store.Store,
	conns *conn.Service,
	sshHosts *terminal.HostService,
	terminals *terminal.Manager,
	sftpMgr *sftpsvc.Manager,
	sessions *session.Manager,
	meta *meta.Service,
	queries *query.Service,
	table *data.Service,
) *Service {
	return &Service{
		version:   version,
		store:     st,
		conns:     conns,
		sshHosts:  sshHosts,
		terminals: terminals,
		sftp:      sftpMgr,
		sessions:  sessions,
		meta:      meta,
		queries:   queries,
		table:     table,
	}
}

// Startup Wails 启动回调。
func (s *Service) Startup(ctx context.Context) {
	s.ctx = ctx
	s.wireTerminalEvents()
	s.wireSftpEvents()
}

// Shutdown Wails 退出回调，释放终端等资源。
func (s *Service) Shutdown(ctx context.Context) {
	s.terminals.CloseAll()
	s.sftp.CloseAll()
}

// GetVersion 返回应用版本。
func (s *Service) GetVersion() ApiResult[model.VersionDO] {
	return OkResult(model.VersionDO{Version: s.version})
}

// ListConnections 列出连接（不含密码）。
func (s *Service) ListConnections() ApiResult[[]model.ConnectionDO] {
	list, err := s.conns.List()
	if err != nil {
		return ErrResult[[]model.ConnectionDO](err)
	}
	if list == nil {
		list = []model.ConnectionDO{}
	}
	for i := range list {
		conn.StripSecrets(&list[i])
	}
	return OkResult(list)
}

// GetConnection 获取连接详情（含密码，仅供编辑）。
func (s *Service) GetConnection(id string) ApiResult[model.ConnectionDO] {
	c, err := s.conns.Get(id)
	if err != nil {
		return ErrResult[model.ConnectionDO](err)
	}
	return OkResult(*c)
}

// SaveConnection 保存连接。
func (s *Service) SaveConnection(c model.ConnectionDO) ApiResult[model.ConnectionDO] {
	out, err := s.conns.Save(c)
	if err != nil {
		return ErrResult[model.ConnectionDO](err)
	}
	conn.StripSecrets(out)
	return OkResult(*out)
}

// DeleteConnection 删除连接。
func (s *Service) DeleteConnection(id string) ApiResult[bool] {
	if err := s.conns.Delete(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// TestConnection 测试连接。
func (s *Service) TestConnection(c model.ConnectionDO) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	if err := s.conns.Test(ctx, c); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// OpenSession 打开会话。
func (s *Service) OpenSession(connectionID, database string) ApiResult[model.SessionInfoDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	info, err := s.sessions.Open(ctx, connectionID, database)
	if err != nil {
		return ErrResult[model.SessionInfoDO](err)
	}
	return OkResult(*info)
}

// CloseSession 关闭会话。
func (s *Service) CloseSession(sessionID string) ApiResult[bool] {
	if err := s.sessions.Close(sessionID); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// GetObjectTree 获取对象树。
func (s *Service) GetObjectTree(sessionID string) ApiResult[[]model.ObjectTreeNodeDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	tree, err := s.meta.GetObjectTree(ctx, sessionID)
	if err != nil {
		return ErrResult[[]model.ObjectTreeNodeDO](err)
	}
	return OkResult(tree)
}

// ListColumns 列出列。
func (s *Service) ListColumns(sessionID, database, table string) ApiResult[[]model.ColumnMetaDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	cols, err := s.meta.ListColumns(ctx, sessionID, database, table)
	if err != nil {
		return ErrResult[[]model.ColumnMetaDO](err)
	}
	return OkResult(cols)
}

// GetTableDDL 获取 DDL。
func (s *Service) GetTableDDL(sessionID, database, table string) ApiResult[model.DDLResultDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	ddl, err := s.meta.GetTableDDL(ctx, sessionID, database, table)
	if err != nil {
		return ErrResult[model.DDLResultDO](err)
	}
	return OkResult(model.DDLResultDO{Content: ddl})
}

// ExecuteSQL 执行 SQL。
func (s *Service) ExecuteSQL(sessionID, database, sqlText string) ApiResult[interface{}] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	res, err := s.queries.ExecuteSQL(ctx, sessionID, database, sqlText)
	if err != nil {
		return ErrResult[interface{}](err)
	}
	return OkResult(res)
}

// QuerySQLPage SQL 分页。
func (s *Service) QuerySQLPage(sessionID, database, sqlText string, page, pageSize int) ApiResult[model.QueryPageDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	res, err := s.queries.QuerySQLPage(ctx, sessionID, database, sqlText, page, pageSize)
	if err != nil {
		return ErrResult[model.QueryPageDO](err)
	}
	return OkResult(*res)
}

// GetTableDataPage 表数据分页（含筛选排序）。
func (s *Service) GetTableDataPage(sessionID, database, table string, query model.TableDataQueryDO) ApiResult[model.TableDataPageDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	res, err := s.table.GetTableDataPage(ctx, sessionID, database, table, query)
	if err != nil {
		return ErrResult[model.TableDataPageDO](err)
	}
	return OkResult(*res)
}

// ApplyTableMutations 提交表变更。
func (s *Service) ApplyTableMutations(sessionID, database, table string, batch model.RowMutationBatchDO) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 60)
	defer cancel()
	if err := s.table.ApplyTableMutations(ctx, sessionID, database, table, batch); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListQueryHistory 查询历史。
func (s *Service) ListQueryHistory(connectionID string, limit int) ApiResult[[]model.QueryHistoryDO] {
	list, err := s.queries.ListHistory(connectionID, limit)
	if err != nil {
		return ErrResult[[]model.QueryHistoryDO](err)
	}
	if list == nil {
		list = []model.QueryHistoryDO{}
	}
	return OkResult(list)
}

// ExportCSVRequest CSV 导出请求。
type ExportCSVRequest struct {
	FileName string     `json:"fileName"`
	Headers  []string   `json:"headers"`
	Rows     [][]string `json:"rows"`
}

// ExportCSV 导出 CSV 到用户选择路径。
func (s *Service) ExportCSV(req ExportCSVRequest) ApiResult[model.ExportResultDO] {
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出 CSV",
		DefaultFilename: req.FileName,
		Filters:         []runtime.FileFilter{{DisplayName: "CSV", Pattern: "*.csv"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	f, err := os.Create(path)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	defer f.Close()
	w := csv.NewWriter(f)
	if len(req.Headers) > 0 {
		if err := w.Write(req.Headers); err != nil {
			return ErrResult[model.ExportResultDO](err)
		}
	}
	for _, row := range req.Rows {
		if err := w.Write(row); err != nil {
			return ErrResult[model.ExportResultDO](err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

// SetDatabase 切换当前会话数据库。
func (s *Service) SetDatabase(sessionID, database string) ApiResult[model.SessionInfoDO] {
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return ErrResult[model.SessionInfoDO](err)
	}
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return ErrResult[model.SessionInfoDO](err)
	}
	if _, err := ad.Execute(ctx, sess.DB, database, fmt.Sprintf("USE `%s`", strings.ReplaceAll(database, "`", "``"))); err != nil {
		return ErrResult[model.SessionInfoDO](err)
	}
	sess.Database = database
	return OkResult(model.SessionInfoDO{
		SessionID:    sess.ID,
		ConnectionID: sess.ConnectionID,
		Database:     database,
	})
}
