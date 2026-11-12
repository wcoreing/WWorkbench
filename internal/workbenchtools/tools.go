package workbenchtools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"WWorkbench/internal/conn"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/session"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/turnctx"

	"github.com/google/uuid"
)

type ctxArgs struct {
	ActiveProduct  string                 `json:"activeProduct"`
	SessionID      string                 `json:"sessionId"`
	ConnectionID   string                 `json:"connectionId"`
	Database       string                 `json:"database"`
	Table          string                 `json:"table"`
	FocusKind      string                 `json:"focusKind"`
	FocusLabel     string                 `json:"focusLabel"`
	TabTitle       string                 `json:"tabTitle"`
	OpenTabsBrief  string                 `json:"openTabsBrief"`
	SelectionBrief string                 `json:"selectionBrief"`
	HostID         string                 `json:"hostId"`
	NoteID         string                 `json:"noteId"`
	Mentions       []model.AgentMentionDO `json:"mentions"`
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
	Intent    string `json:"intent"`
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
		"connections":   conns,
		"sshHosts":      sshHosts,
		"openSessions":  open,
		"recentQueries": history,
	}
	snap := model.AgentContextDO{
		ActiveProduct:  in.ActiveProduct,
		SessionID:      in.SessionID,
		ConnectionID:   in.ConnectionID,
		Database:       in.Database,
		Table:          in.Table,
		FocusKind:      in.FocusKind,
		FocusLabel:     in.FocusLabel,
		TabTitle:       in.TabTitle,
		OpenTabsBrief:  in.OpenTabsBrief,
		SelectionBrief: in.SelectionBrief,
		HostID:         in.HostID,
		NoteID:         in.NoteID,
		Mentions:       in.Mentions,
	}
	turnctx.ApplySnapshot(out, snap)
	if d.Docker != nil {
		if ctxList, err := d.Docker.ListContexts(ctx); err == nil {
			out["dockerContexts"] = ctxList
		}
	}
	if logList, err := d.Store.ListLogSources(); err == nil {
		out["logSources"] = logList
	}
	if httpList, err := d.Store.ListHTTPRequests(); err == nil {
		out["httpRequests"] = httpList
	}
	if d.Terminals != nil {
		out["openTerminals"] = d.Terminals.ListSessionTails(0)
		if recent := d.Terminals.RecentOpenSession(); recent.SessionID != "" {
			out["terminalSessionId"] = recent.SessionID
			out["terminalTitle"] = recent.Title
			out["terminalHostId"] = recent.HostID
		}
	}
	if cards := ListIntentCards(20); len(cards) > 0 {
		out["intentCards"] = cards
	}
	if d.Store != nil {
		if pols, err := d.Store.ListBackupPolicies(); err == nil && len(pols) > 0 {
			out["backupPolicies"] = pols
		}
		if runs, err := d.Store.ListBackupRuns("", 10); err == nil && len(runs) > 0 {
			out["backupRuns"] = runs
		}
		if taskRuns, err := d.Store.ListTaskRuns("", 10); err == nil && len(taskRuns) > 0 {
			out["taskRuns"] = taskRuns
		}
		if d.Notebook != nil {
			if workflows := d.Notebook.ListWorkflowsSSOT(10); len(workflows) > 0 {
				out["workflows"] = workflows
			}
		}
		hosts := notebook.ContextHostIDs(snap)
		if d.Notebook != nil {
			var prefixes []string
			if d.SSHHosts != nil {
				for _, id := range hosts {
					h, err := d.SSHHosts.Get(id)
					if err != nil || h == nil {
						continue
					}
					dir, _, _, err := d.Notebook.EnsureHostMemoryBook(h.ID, h.Name, h.User, h.Host, h.Port)
					if err == nil && dir != "" {
						prefixes = append(prefixes, dir)
					}
				}
			}
			if mem, err := d.Notebook.ListMemoryNotesForContext(hosts, snap.ConnectionID, 5, prefixes...); err == nil && len(mem) > 0 {
				items := make([]map[string]interface{}, 0, len(mem))
				for _, n := range mem {
					items = append(items, map[string]interface{}{
						"noteId":       n.ID,
						"title":        n.Title,
						"role":         n.Role,
						"sshHostId":    n.SSHHostID,
						"connectionId": n.ConnectionID,
						"updatedAt":    n.UpdatedAt,
					})
				}
				out["memoryNotes"] = items
			}
			if wp := d.Notebook.WorkspacePath(); wp != "" {
				out["notebookWorkspace"] = wp
			}
		}
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
		preview := map[string]interface{}{
			"sessionId": in.SessionID,
			"database":  in.Database,
			"sql":       sqlText,
			"sqlKind":   "write",
		}
		connID := ""
		if sess, err := d.Sessions.Get(in.SessionID); err == nil && sess != nil {
			connID = sess.ConnectionID
			preview["connectionId"] = connID
			if pols := matchDBPoliciesForConnection(d, connID); len(pols) > 0 {
				preview["backupBefore"] = true
				names := make([]string, 0, len(pols))
				for _, p := range pols {
					names = append(names, p.Name)
				}
				preview["backupPolicies"] = names
			}
		}
		summary := "执行写入 SQL：" + truncate(sqlText, 120)
		if intent := strings.TrimSpace(in.Intent); intent != "" {
			preview["intent"] = intent
			summary = truncateRunes(intent, intentTitleMaxRune)
		}
		return Confirm(uuid.NewString(), summary, preview)
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
		return Fail(sqlExecErr(err))
	}
	return OKData(res)
}

// ExecuteSQLConfirmed 用户确认后执行待执行的写入 SQL（有 beforeWrite 库策略则先备份）。
func ExecuteSQLConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in executeSQLArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	connID := ""
	db := in.Database
	if sess, err := d.Sessions.Get(in.SessionID); err == nil && sess != nil {
		connID = sess.ConnectionID
		if db == "" {
			db = sess.Database
		}
	}
	if bak := ensureDBBackupBeforeWrite(ctx, d, connID, strings.TrimSpace(in.Intent)); !bak.OK {
		return bak
	}
	cctx, cancel := session.WithTimeout(ctx, 60)
	defer cancel()
	res, err := d.Queries.ExecuteSQL(cctx, in.SessionID, db, strings.TrimSpace(in.SQL))
	if err != nil {
		return Fail(sqlExecErr(err))
	}
	return OKData(res)
}

// sqlExecErr 把超时/底层 detail 写进工具错误，避免只剩「查询失败」。
func sqlExecErr(err error) string {
	if err == nil {
		return "执行失败"
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "deadline exceeded") {
		return "查询超时（限 60s）。请缩小范围、避免相关子查询扫全表，或拆成带索引的轻量 SQL"
	}
	if ae, ok := err.(*errno.AppError); ok {
		if ae.Detail != "" {
			return ae.Message + "：" + ae.Detail
		}
		return ae.Message
	}
	return err.Error()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
