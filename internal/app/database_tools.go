package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// exportSQLMaxRows 单表导出 INSERT 行数上限（MVP）。
const exportSQLMaxRows = 100000

// ExportConnectionsToFile 导出连接到 JSON 文件。
func (s *Service) ExportConnectionsToFile(includeSecrets bool) ApiResult[model.ExportResultDO] {
	jsonText, err := s.conns.ExportConnections(includeSecrets)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出连接",
		DefaultFilename: "connections.json",
		Filters:         []runtime.FileFilter{{DisplayName: "JSON", Pattern: "*.json"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := os.WriteFile(path, []byte(jsonText), 0o600); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

// ImportConnectionsFromFile 从 JSON 文件导入连接。
func (s *Service) ImportConnectionsFromFile() ApiResult[int] {
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title:   "导入连接",
		Filters: []runtime.FileFilter{{DisplayName: "JSON", Pattern: "*.json"}},
	})
	if err != nil {
		return ErrResult[int](err)
	}
	if path == "" {
		return OkResult(0)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ErrResult[int](err)
	}
	count, err := s.conns.ImportConnections(string(data))
	if err != nil {
		return ErrResult[int](err)
	}
	return OkResult(count)
}

// ExecuteSQLFile 选择并执行 SQL 文件（database 可为空，用于建库等语句）。
func (s *Service) ExecuteSQLFile(sessionID, database string) ApiResult[interface{}] {
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title:   "导入 SQL",
		Filters: []runtime.FileFilter{{DisplayName: "SQL", Pattern: "*.sql"}, {DisplayName: "All", Pattern: "*"}},
	})
	if err != nil {
		return ErrResult[interface{}](err)
	}
	if path == "" {
		return OkResult[interface{}](nil)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ErrResult[interface{}](err)
	}
	sqlText := strings.TrimSpace(string(data))
	if sqlText == "" {
		return ErrResult[interface{}](errno.New(errno.CodeInvalidArg, "SQL 文件为空", path))
	}
	ctx, cancel := session.WithTimeout(s.ctx, 300)
	defer cancel()
	res, err := s.queries.ExecuteSQL(ctx, sessionID, database, sqlText)
	if err != nil {
		return ErrResult[interface{}](err)
	}
	return OkResult(res)
}

// CreateDatabase 创建数据库。
func (s *Service) CreateDatabase(sessionID, name, charset, collation string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.meta.CreateDatabase(ctx, sessionID, name, charset, collation); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// DropDatabase 删除数据库。
func (s *Service) DropDatabase(sessionID, name string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 60)
	defer cancel()
	if err := s.meta.DropDatabase(ctx, sessionID, name); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ExportTableInsertSQL 导出表 INSERT 语句到文件（兼容旧调用；新入口请用 ExportTableSQL）。
func (s *Service) ExportTableInsertSQL(sessionID, database, table string, maxRows int) ApiResult[model.ExportResultDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 300)
	defer cancel()
	sqlText, err := s.table.ExportTableInsertSQL(ctx, sessionID, database, table, maxRows)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return s.saveSQLExport(table+".sql", "导出 INSERT SQL", sqlText)
}

// ExportTableSQL 导出单表 DDL + INSERT 到文件；taskID 用于进度事件与取消。
func (s *Service) ExportTableSQL(sessionID, database, table, taskID string, maxRows int) ApiResult[model.ExportResultDO] {
	ctx, cleanup := s.bindSQLExportCtx(taskID, 300)
	defer cleanup()
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出表 SQL",
		DefaultFilename: table + ".sql",
		Filters:         []runtime.FileFilter{{DisplayName: "SQL", Pattern: "*.sql"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := ctx.Err(); err != nil {
		return s.finishSQLExportError(taskID, database, table, "", 0, 1, err)
	}
	s.emitSQLExportProgress(model.SQLExportProgressDO{
		TaskID: taskID, Database: database, Table: table, Done: 0, Total: 1, State: "running", Message: table,
	})
	sqlText, err := s.buildTableSQL(ctx, sessionID, database, table, maxRows)
	if err != nil {
		return s.finishSQLExportError(taskID, database, table, path, 0, 1, err)
	}
	if err := os.WriteFile(path, []byte(sqlText), 0o600); err != nil {
		return s.finishSQLExportError(taskID, database, table, path, 0, 1, err)
	}
	s.emitSQLExportProgress(model.SQLExportProgressDO{
		TaskID: taskID, Database: database, Table: table, Done: 1, Total: 1, State: "done", Message: table,
	})
	return OkResult(model.ExportResultDO{Path: path})
}

// ExportDatabaseSQL 导出库内全部表的 DDL + INSERT；taskID 用于进度事件与取消。
func (s *Service) ExportDatabaseSQL(sessionID, database, taskID string, maxRows int) ApiResult[model.ExportResultDO] {
	if database == "" {
		return ErrResult[model.ExportResultDO](errno.New(errno.CodeInvalidArg, "数据库名不能为空", ""))
	}
	ctx, cleanup := s.bindSQLExportCtx(taskID, 600)
	defer cleanup()
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出库 SQL",
		DefaultFilename: database + ".sql",
		Filters:         []runtime.FileFilter{{DisplayName: "SQL", Pattern: "*.sql"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := ctx.Err(); err != nil {
		return s.finishSQLExportError(taskID, database, "", "", 0, 0, err)
	}
	nodes, err := s.meta.ListDatabaseObjects(ctx, sessionID, database)
	if err != nil {
		return s.finishSQLExportError(taskID, database, "", path, 0, 0, err)
	}
	tables := make([]string, 0, len(nodes))
	for _, n := range nodes {
		if n.NodeType == "table" && n.Table != "" {
			tables = append(tables, n.Table)
		}
	}
	total := len(tables)
	if total == 0 {
		total = 1
	}
	s.emitSQLExportProgress(model.SQLExportProgressDO{
		TaskID: taskID, Database: database, Done: 0, Total: total, State: "running", Message: database,
	})
	f, err := os.Create(path)
	if err != nil {
		return s.finishSQLExportError(taskID, database, "", path, 0, total, err)
	}
	defer f.Close()
	if _, err := fmt.Fprintf(f, "-- WWorkbench export\n-- Database: %s\n-- Max rows per table: %d\n\n", database, clampExportSQLMaxRows(maxRows)); err != nil {
		return s.finishSQLExportError(taskID, database, "", path, 0, total, err)
	}
	if len(tables) == 0 {
		if _, err := f.WriteString("-- （无可导出的表）\n"); err != nil {
			return s.finishSQLExportError(taskID, database, "", path, 0, total, err)
		}
		s.emitSQLExportProgress(model.SQLExportProgressDO{
			TaskID: taskID, Database: database, Done: 1, Total: 1, State: "done", Message: database,
		})
		return OkResult(model.ExportResultDO{Path: path})
	}
	for i, tableName := range tables {
		if err := ctx.Err(); err != nil {
			return s.finishSQLExportError(taskID, database, tableName, path, i, total, err)
		}
		s.emitSQLExportProgress(model.SQLExportProgressDO{
			TaskID: taskID, Database: database, Table: tableName, Done: i, Total: total, State: "running", Message: tableName,
		})
		section, err := s.buildTableSQL(ctx, sessionID, database, tableName, maxRows)
		if err != nil {
			return s.finishSQLExportError(taskID, database, tableName, path, i, total, err)
		}
		if _, err := f.WriteString(section); err != nil {
			return s.finishSQLExportError(taskID, database, tableName, path, i, total, err)
		}
	}
	s.emitSQLExportProgress(model.SQLExportProgressDO{
		TaskID: taskID, Database: database, Done: total, Total: total, State: "done", Message: database,
	})
	return OkResult(model.ExportResultDO{Path: path})
}

// CancelSQLExport 取消进行中的 SQL 导出任务。
func (s *Service) CancelSQLExport(taskID string) ApiResult[bool] {
	if taskID == "" {
		return OkResult(false)
	}
	s.sqlExportMu.Lock()
	cancel, ok := s.sqlExportCancels[taskID]
	s.sqlExportMu.Unlock()
	if !ok {
		return OkResult(false)
	}
	cancel()
	return OkResult(true)
}

// buildTableSQL 拼装单表 DDL + INSERT 文本。
func (s *Service) buildTableSQL(ctx context.Context, sessionID, database, table string, maxRows int) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ddl, err := s.meta.GetTableDDL(ctx, sessionID, database, table)
	if err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	inserts, err := s.table.ExportTableInsertSQL(ctx, sessionID, database, table, clampExportSQLMaxRows(maxRows))
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("\n-- ----------------------------\n-- Table structure: `%s`.`%s`\n-- ----------------------------\n", database, table))
	ddl = strings.TrimSpace(ddl)
	if ddl != "" {
		b.WriteString(ddl)
		if !strings.HasSuffix(ddl, ";") {
			b.WriteString(";")
		}
		b.WriteString("\n")
	}
	b.WriteString(fmt.Sprintf("\n-- ----------------------------\n-- Records of `%s`.`%s`\n-- ----------------------------\n", database, table))
	inserts = strings.TrimSpace(inserts)
	if inserts != "" {
		b.WriteString(inserts)
		b.WriteString("\n")
	} else {
		b.WriteString("-- （无数据或未导出行）\n")
	}
	b.WriteString("\n")
	return b.String(), nil
}

// saveSQLExport 弹出保存对话框并写入 SQL 文本。
func (s *Service) saveSQLExport(defaultName, title, sqlText string) ApiResult[model.ExportResultDO] {
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: defaultName,
		Filters:         []runtime.FileFilter{{DisplayName: "SQL", Pattern: "*.sql"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := os.WriteFile(path, []byte(sqlText), 0o600); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

func clampExportSQLMaxRows(maxRows int) int {
	if maxRows <= 0 {
		return exportSQLMaxRows
	}
	if maxRows > exportSQLMaxRows {
		return exportSQLMaxRows
	}
	return maxRows
}

// bindSQLExportCtx 绑定可取消导出上下文。
func (s *Service) bindSQLExportCtx(taskID string, timeoutSec int) (context.Context, context.CancelFunc) {
	base, timeoutCancel := session.WithTimeout(s.ctx, timeoutSec)
	if taskID == "" {
		return base, timeoutCancel
	}
	ctx, cancel := context.WithCancel(base)
	s.sqlExportMu.Lock()
	s.sqlExportCancels[taskID] = cancel
	s.sqlExportMu.Unlock()
	return ctx, func() {
		cancel()
		timeoutCancel()
		s.sqlExportMu.Lock()
		delete(s.sqlExportCancels, taskID)
		s.sqlExportMu.Unlock()
	}
}

func (s *Service) emitSQLExportProgress(evt model.SQLExportProgressDO) {
	if evt.TaskID == "" || s.ctx == nil {
		return
	}
	runtime.EventsEmit(s.ctx, "db:export-progress", evt)
}

func (s *Service) finishSQLExportError(taskID, database, table, path string, done, total int, err error) ApiResult[model.ExportResultDO] {
	if path != "" && isSQLExportCanceled(err) {
		_ = os.Remove(path)
	}
	state := "error"
	msg := err.Error()
	if isSQLExportCanceled(err) {
		state = "cancelled"
		msg = "已取消导出"
		err = errno.New(errno.CodeCancelled, "已取消导出", "")
	}
	s.emitSQLExportProgress(model.SQLExportProgressDO{
		TaskID: taskID, Database: database, Table: table, Done: done, Total: total, State: state, Message: msg,
	})
	return ErrResult[model.ExportResultDO](err)
}

func isSQLExportCanceled(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if ae := errno.Extract(err); ae != nil && ae.Code == errno.CodeCancelled {
		return true
	}
	return false
}
