package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WNavicat/internal/conn"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
	"WNavicat/internal/terminal"

	"github.com/google/uuid"
)

type ctxArgs struct {
	ActiveProduct string                `json:"activeProduct"`
	SessionID     string                `json:"sessionId"`
	ConnectionID  string                `json:"connectionId"`
	Database      string                `json:"database"`
	Mentions      []model.AgentMentionDO `json:"mentions"`
}

type openSessionArgs struct {
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
}

type sessionArgs struct {
	SessionID string `json:"sessionId"`
}

type listTablesArgs struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
}

type describeTableArgs struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Table     string `json:"table"`
}

type executeSQLArgs struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	SQL       string `json:"sql"`
	Readonly  *bool  `json:"readonly"`
}

// toolGetWorkbenchContext 组装工作台上下文快照。
func toolGetWorkbenchContext(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in ctxArgs
	_ = json.Unmarshal(raw, &in)
	list, err := d.Conns.List()
	if err != nil {
		return Fail(err.Error())
	}
	conns := make([]model.ConnectionDO, 0, len(list))
	for i := range list {
		c := list[i]
		conn.StripSecrets(&c)
		conns = append(conns, c)
	}
	open := d.Sessions.ListOpen()
	var history []model.QueryHistoryDO
	if in.ConnectionID != "" {
		history, _ = d.Queries.ListHistory(in.ConnectionID, 5)
	}
	sshList, err := d.SSHHosts.List()
	if err != nil {
		return Fail(err.Error())
	}
	sshHosts := make([]model.SSHHostDO, 0, len(sshList))
	for i := range sshList {
		h := sshList[i]
		terminal.StripSecrets(&h)
		sshHosts = append(sshHosts, h)
	}
	out := map[string]interface{}{
		"activeProduct": in.ActiveProduct,
		"sessionId":     in.SessionID,
		"connectionId":  in.ConnectionID,
		"database":      in.Database,
		"connections":   conns,
		"sshHosts":      sshHosts,
		"openSessions":  open,
		"recentQueries": history,
	}
	if len(in.Mentions) > 0 {
		out["mentions"] = in.Mentions
	}
	return OKData(out)
}

// toolListSSHHosts 列出 SSH 主机。
func toolListSSHHosts(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	list, err := d.SSHHosts.List()
	if err != nil {
		return Fail(err.Error())
	}
	for i := range list {
		terminal.StripSecrets(&list[i])
	}
	return OKData(list)
}

// toolListConnections 列出连接。
func toolListConnections(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	list, err := d.Conns.List()
	if err != nil {
		return Fail(err.Error())
	}
	for i := range list {
		conn.StripSecrets(&list[i])
	}
	return OKData(list)
}

// toolOpenDatabaseSession 打开数据库会话。
func toolOpenDatabaseSession(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in openSessionArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	if strings.TrimSpace(in.ConnectionID) == "" {
		return Fail("缺少 connectionId")
	}
	cctx, cancel := session.WithTimeout(ctx, 30)
	defer cancel()
	info, err := d.Sessions.Open(cctx, in.ConnectionID, in.Database)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(info)
}

// toolCloseDatabaseSession 关闭会话。
func toolCloseDatabaseSession(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in sessionArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	if err := d.Sessions.Close(in.SessionID); err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]bool{"closed": true})
}

// toolListTables 列出库内表。
func toolListTables(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in listTablesArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	cctx, cancel := session.WithTimeout(ctx, 30)
	defer cancel()
	tree, err := d.Meta.GetObjectTree(cctx, in.SessionID)
	if err != nil {
		return Fail(err.Error())
	}
	var tables []string
	for _, dbNode := range tree {
		if in.Database != "" && dbNode.Database != in.Database && dbNode.Label != in.Database {
			continue
		}
		for _, ch := range dbNode.Children {
			if ch.NodeType == "table" || ch.NodeType == "view" {
				tables = append(tables, ch.Label)
			}
		}
	}
	return OKData(map[string]interface{}{"database": in.Database, "tables": tables})
}

// toolDescribeTable 描述表结构。
func toolDescribeTable(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in describeTableArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	cctx, cancel := session.WithTimeout(ctx, 30)
	defer cancel()
	cols, err := d.Meta.ListColumns(cctx, in.SessionID, in.Database, in.Table)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"database": in.Database,
		"table":    in.Table,
		"columns":  cols,
	})
}

// toolExecuteSQL 执行 SQL（写入需确认）。
func toolExecuteSQL(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in executeSQLArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	sqlText := strings.TrimSpace(in.SQL)
	if sqlText == "" {
		return Fail("SQL 不能为空")
	}
	readonly := true
	if in.Readonly != nil {
		readonly = *in.Readonly
	}
	kind := ClassifySQL(sqlText)
	if kind == SQLBlocked {
		return Fail("该 SQL 被安全策略禁止")
	}
	if readonly && kind == SQLWrite {
		return Fail("readonly 模式下不可执行写入 SQL，请设置 readonly=false 并等待用户确认")
	}
	if kind == SQLWrite {
		settings := d.Store.GetAgentSettings()
		if !settings.AllowWrite && (in.Readonly == nil || *in.Readonly) {
			return Fail("写入 SQL 需在 AI 设置中开启「允许写入请求」，并使用 readonly=false")
		}
		preview := map[string]string{
			"sessionId": in.SessionID,
			"database":  in.Database,
			"sql":       sqlText,
		}
		return Confirm(uuid.NewString(), "执行写入 SQL："+truncate(sqlText, 120), preview)
	}
	cctx, cancel := session.WithTimeout(ctx, 60)
	defer cancel()
	db := in.Database
	if db == "" {
		if sess, err := d.Sessions.Get(in.SessionID); err == nil {
			db = sess.Database
		}
	}
	res, err := d.Queries.ExecuteSQL(cctx, in.SessionID, db, sqlText)
	if err != nil {
		if ae, ok := err.(*errno.AppError); ok {
			return Fail(ae.Message)
		}
		return Fail(err.Error())
	}
	return OKData(res)
}

// ExecuteSQLConfirmed 用户确认后执行待执行的写入 SQL。
func ExecuteSQLConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in executeSQLArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	cctx, cancel := session.WithTimeout(ctx, 60)
	defer cancel()
	db := in.Database
	if db == "" {
		if sess, err := d.Sessions.Get(in.SessionID); err == nil {
			db = sess.Database
		}
	}
	res, err := d.Queries.ExecuteSQL(cctx, in.SessionID, db, strings.TrimSpace(in.SQL))
	if err != nil {
		if ae, ok := err.(*errno.AppError); ok {
			return Fail(ae.Message)
		}
		return Fail(err.Error())
	}
	return OKData(res)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
