package app

import (
	"os"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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

// ExecuteSQLFile 选择并执行 SQL 文件。
func (s *Service) ExecuteSQLFile(sessionID, database string) ApiResult[interface{}] {
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title:   "执行 SQL 文件",
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
	ctx, cancel := session.WithTimeout(s.ctx, 120)
	defer cancel()
	res, err := s.queries.ExecuteSQL(ctx, sessionID, database, sqlText)
	if err != nil {
		return ErrResult[interface{}](err)
	}
	return OkResult(res)
}

// ExportTableInsertSQL 导出表 INSERT 语句到文件。
func (s *Service) ExportTableInsertSQL(sessionID, database, table string, maxRows int) ApiResult[model.ExportResultDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 60)
	defer cancel()
	sqlText, err := s.table.ExportTableInsertSQL(ctx, sessionID, database, table, maxRows)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出 INSERT SQL",
		DefaultFilename: table + ".sql",
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
