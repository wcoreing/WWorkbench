package store

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const mcpCallLogSelectSQL = `SELECT id, at, caller, tool, intent, ok, error, duration_ms, resources_json, args_summary, task_session FROM mcp_call_logs`

// AppendMCPCallLog 追加一条 MCP/工具调用流水。
func (s *Store) AppendMCPCallLog(row model.MCPCallLogDO) (model.MCPCallLogDO, error) {
	if row.ID == "" {
		row.ID = uuid.NewString()
	}
	if row.At == 0 {
		row.At = time.Now().UnixMilli()
	}
	if row.ResourcesJSON == "" {
		if len(row.Resources) == 0 {
			row.ResourcesJSON = "[]"
		} else {
			b, _ := json.Marshal(row.Resources)
			row.ResourcesJSON = string(b)
		}
	}
	_, err := s.db.Exec(
		`INSERT INTO mcp_call_logs (id, at, caller, tool, intent, ok, error, duration_ms, resources_json, args_summary, task_session)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ID, row.At, row.Caller, row.Tool, row.Intent, boolToInt(row.OK), row.Error,
		row.DurationMs, row.ResourcesJSON, row.ArgsSummary, row.TaskSession,
	)
	if err != nil {
		return row, errno.Wrap(errno.CodeStoreFailed, "写入 MCP 调用日志失败", err)
	}
	if len(row.Resources) == 0 && row.ResourcesJSON != "" && row.ResourcesJSON != "[]" {
		_ = json.Unmarshal([]byte(row.ResourcesJSON), &row.Resources)
	}
	return row, nil
}

// GetMCPCallLog 按 id 取一条。
func (s *Store) GetMCPCallLog(id string) (model.MCPCallLogDO, error) {
	row := s.db.QueryRow(mcpCallLogSelectSQL+` WHERE id = ?`, strings.TrimSpace(id))
	out, err := scanMCPCallLog(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return out, errno.New(errno.CodeNotFound, "MCP 调用日志不存在", id)
		}
		return out, errno.Wrap(errno.CodeStoreFailed, "读取 MCP 调用日志失败", err)
	}
	return out, nil
}

// ListMCPCallLogs 按过滤条件列出近期调用（默认按 at 降序）。
func (s *Store) ListMCPCallLogs(f model.MCPCallLogFilter) ([]model.MCPCallLogDO, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	needResourceFilter := strings.TrimSpace(f.ResourceKind) != "" || strings.TrimSpace(f.ResourceID) != ""
	fetch := limit
	if needResourceFilter {
		fetch = limit * 20
		if fetch > 2000 {
			fetch = 2000
		}
	}

	var where []string
	var args []interface{}
	if f.Since > 0 {
		where = append(where, "at >= ?")
		args = append(args, f.Since)
	}
	if t := strings.TrimSpace(f.Tool); t != "" {
		where = append(where, "tool = ?")
		args = append(args, t)
	}
	if c := strings.TrimSpace(f.Caller); c != "" {
		where = append(where, "caller = ?")
		args = append(args, c)
	}
	if ic := strings.TrimSpace(f.IntentContains); ic != "" {
		where = append(where, "intent LIKE ?")
		args = append(args, "%"+ic+"%")
	}
	q := mcpCallLogSelectSQL
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY at DESC LIMIT ?"
	args = append(args, fetch)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 MCP 调用日志失败", err)
	}
	defer rows.Close()

	rk := strings.TrimSpace(f.ResourceKind)
	rid := strings.TrimSpace(f.ResourceID)
	out := make([]model.MCPCallLogDO, 0, limit)
	for rows.Next() {
		item, err := scanMCPCallLog(rows)
		if err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "扫描 MCP 调用日志失败", err)
		}
		if needResourceFilter && !mcpLogMatchesResource(item.Resources, rk, rid) {
			continue
		}
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "遍历 MCP 调用日志失败", err)
	}
	return out, nil
}

func mcpLogMatchesResource(refs []model.MCPAssetRef, kind, id string) bool {
	for _, r := range refs {
		if kind != "" && r.Kind != kind {
			continue
		}
		if id != "" && r.ID != id {
			continue
		}
		return true
	}
	return false
}

type mcpCallLogScanner interface {
	Scan(dest ...interface{}) error
}

func scanMCPCallLog(row mcpCallLogScanner) (model.MCPCallLogDO, error) {
	var out model.MCPCallLogDO
	var okInt int
	if err := row.Scan(
		&out.ID, &out.At, &out.Caller, &out.Tool, &out.Intent, &okInt, &out.Error,
		&out.DurationMs, &out.ResourcesJSON, &out.ArgsSummary, &out.TaskSession,
	); err != nil {
		return out, err
	}
	out.OK = okInt != 0
	if out.ResourcesJSON == "" {
		out.ResourcesJSON = "[]"
	}
	_ = json.Unmarshal([]byte(out.ResourcesJSON), &out.Resources)
	if out.Resources == nil {
		out.Resources = []model.MCPAssetRef{}
	}
	return out, nil
}
