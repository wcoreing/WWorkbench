package turnctx

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/model"
)

const (
	maxSnapshotRunes = 4200
	maxTabsBrief      = 280
	maxFocusLabel     = 120
)

// Gather 组装本轮界面快照（Turn Transport）进 feedforward，与界面一致；细节用工具核实。
func Gather(ctx model.AgentContextDO, userText string) string {
	var b strings.Builder
	b.WriteString("## 工作台现状（Turn Transport · 与界面一致）\n")
	if ctx.ActiveProduct != "" {
		fmt.Fprintf(&b, "- **产品线**：`%s`\n", ctx.ActiveProduct)
	}

	focus := strings.TrimSpace(ctx.FocusLabel)
	if focus == "" {
		focus = deriveFocusLabel(ctx)
	}
	if focus != "" {
		fmt.Fprintf(&b, "- **界面焦点**：`%s`", trimBrief(focus, maxFocusLabel))
		if k := strings.TrimSpace(ctx.FocusKind); k != "" {
			fmt.Fprintf(&b, "（%s）", k)
		}
		b.WriteByte('\n')
		b.WriteString("- 用户说「这个 / 这张表 / 这个库 / 这个主机 / 这个请求」时优先指界面焦点，勿空猜。\n")
	} else {
		b.WriteString("- **界面焦点**：无（以 @ 绑定、连接信息或工具查询为准）\n")
	}

	if ctx.ConnectionID != "" {
		fmt.Fprintf(&b, "- **数据库连接** connectionId=`%s`", ctx.ConnectionID)
		if ctx.Database != "" {
			fmt.Fprintf(&b, " database=`%s`", ctx.Database)
		}
		if ctx.Table != "" {
			fmt.Fprintf(&b, " table=`%s`", ctx.Table)
		}
		if ctx.SessionID != "" {
			fmt.Fprintf(&b, " sessionId=`%s`", ctx.SessionID)
		}
		b.WriteByte('\n')
	} else if ctx.SessionID != "" {
		fmt.Fprintf(&b, "- **会话** sessionId=`%s`\n", ctx.SessionID)
	}

	if ctx.TabTitle != "" {
		fmt.Fprintf(&b, "- **当前标签**：%s\n", trimBrief(ctx.TabTitle, 80))
	}
	if nid := strings.TrimSpace(ctx.NoteID); nid != "" {
		fmt.Fprintf(&b, "- **当前笔记** noteId=`%s`", nid)
		if tb := strings.TrimSpace(ctx.TabTitle); tb != "" {
			fmt.Fprintf(&b, " 标题「%s」", trimBrief(tb, 80))
		}
		b.WriteString("\n- 用户说「这篇 / 当前笔记 / 打开的笔记」时用 get_note(noteId) 读；写训练/巡检记录不要默认追加到这篇（常是无关「未命名」草稿），list_notes 按标题定位或新建明确 title。笔记在工作台库内，禁止 cat 文件，禁止 recall_resource。\n")
	}
	if ot := strings.TrimSpace(ctx.OpenTabsBrief); ot != "" {
		fmt.Fprintf(&b, "- **中栏标签**：%s\n", trimBrief(ot, maxTabsBrief))
	}
	if sel := strings.TrimSpace(ctx.SelectionBrief); sel != "" {
		fmt.Fprintf(&b, "- **树/资源选中**：%s\n", trimBrief(sel, 160))
	}

	hasSSHMention := false
	if len(ctx.Mentions) > 0 {
		b.WriteString("- **本轮 @ 绑定**（优先使用，勿编造 ID）:\n")
		for _, m := range ctx.Mentions {
			switch m.Kind {
			case "ssh":
				hasSSHMention = true
				fmt.Fprintf(&b, "  · SSH「%s」 hostId=%s\n", m.Label, m.ID)
			case "database":
				fmt.Fprintf(&b, "  · 数据库「%s」 connectionId=%s\n", m.Label, m.ID)
			case "docker":
				if strings.HasPrefix(m.ID, "docker:") {
					fmt.Fprintf(&b, "  · Docker 容器主机「%s」 hostId=%s\n", m.Label, m.ID)
				} else {
					fmt.Fprintf(&b, "  · Docker 上下文「%s」 contextId=%s\n", m.Label, m.ID)
				}
			case "log":
				fmt.Fprintf(&b, "  · 日志源「%s」 logSourceId=%s\n", m.Label, m.ID)
			case "http":
				fmt.Fprintf(&b, "  · HTTP「%s」 requestId=%s\n", m.Label, m.ID)
			default:
				fmt.Fprintf(&b, "  · %s「%s」 id=%s\n", m.Kind, m.Label, m.ID)
			}
		}
	}
	if hasSSHMention {
		b.WriteString("- **默认目标主机**：本轮已绑定 SSH，用户未改口时优先按该主机做 shell / 远程 Docker / 部署；列出其它连接可作对照。若任务目标仍不明确（例如用户明确说「本地」或绑定与需求冲突），再向用户确认。\n")
		b.WriteString("- SSH 连不上时先核对绑定里的 user@host:port 是否与控制台一致；握手 EOF 表示该端口没有 SSH（区域名/端口填错或实例关机），不是 known_hosts。\n")
	} else if strings.HasPrefix(strings.TrimSpace(ctx.FocusKind), "terminal.ssh") ||
		strings.Contains(strings.ToLower(ctx.SelectionBrief), "ssh ") {
		b.WriteString("- 界面焦点在 SSH 主机；用户说「这台 / 当前主机」时优先指该焦点。\n")
	}
	if hint := userSSHHint(userText, ctx.Mentions); hint != "" {
		b.WriteString(hint)
	}
	b.WriteString("- 容器启停/删除用 start_container / stop_container / remove_container（会确认）。shell_run=注入给人看（pip/下载/训练）；shell_probe=无头只读短探针；看可见终端输出用 get_shell_output 按需分页。\n")
	b.WriteString("- 资产落盘：HTTP→save_http_request+save_http_environment；SSH→save_ssh_host/save_ssh_forward；库→save_connection；日志→save_log_source；Docker→save_docker_context。\n")
	out := b.String()
	if utf8.RuneCountInString(out) > maxSnapshotRunes {
		r := []rune(out)
		out = string(r[:maxSnapshotRunes]) + "\n…"
	}
	return out
}

// AttachSSHEndpoints 把已保存的 user@host:port 写入 SSH @ 绑定标签，避免助手只看到昵称。
func AttachSSHEndpoints(ctx model.AgentContextDO, lookup func(id string) (user, host string, port int, ok bool)) model.AgentContextDO {
	if lookup == nil || len(ctx.Mentions) == 0 {
		return ctx
	}
	out := ctx
	out.Mentions = append([]model.AgentMentionDO(nil), ctx.Mentions...)
	for i, m := range out.Mentions {
		if m.Kind != "ssh" {
			continue
		}
		user, host, port, ok := lookup(m.ID)
		if !ok || strings.TrimSpace(host) == "" {
			continue
		}
		if port <= 0 {
			port = 22
		}
		addr := fmt.Sprintf("%s@%s:%d", user, host, port)
		if strings.Contains(m.Label, addr) {
			continue
		}
		label := strings.TrimSpace(m.Label)
		if label == "" {
			out.Mentions[i].Label = addr
			continue
		}
		out.Mentions[i].Label = label + " · " + addr
	}
	return out
}

func deriveFocusLabel(ctx model.AgentContextDO) string {
	db := strings.TrimSpace(ctx.Database)
	table := strings.TrimSpace(ctx.Table)
	if db != "" && table != "" {
		return db + "." + table
	}
	if table != "" {
		return table
	}
	if db != "" {
		return db
	}
	return strings.TrimSpace(ctx.TabTitle)
}

func trimBrief(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}

// FocusRefFromContext 推导 sessions.focus_ref。
func FocusRefFromContext(ctx model.AgentContextDO) string {
	for _, m := range ctx.Mentions {
		switch m.Kind {
		case "ssh":
			return "ssh:" + m.ID
		case "database":
			if ctx.Database != "" && ctx.Table != "" {
				return "db:" + m.ID + "/" + ctx.Database + "." + ctx.Table
			}
			if ctx.Database != "" {
				return "db:" + m.ID + "/" + ctx.Database
			}
			return "db:" + m.ID
		case "docker":
			return "docker:" + m.ID
		}
	}
	if nid := strings.TrimSpace(ctx.NoteID); nid != "" {
		return "notebook:" + nid
	}
	if ctx.ConnectionID != "" {
		if ctx.Database != "" && ctx.Table != "" {
			return "db:" + ctx.ConnectionID + "/" + ctx.Database + "." + ctx.Table
		}
		if ctx.Database != "" {
			return "db:" + ctx.ConnectionID + "/" + ctx.Database
		}
		return "db:" + ctx.ConnectionID
	}
	return ""
}

// SkillPathsFromContext 推导本轮 Skill 匹配路径（产品线 / @绑定 / 焦点表）。
func SkillPathsFromContext(ctx model.AgentContextDO) []string {
	var out []string
	seen := map[string]struct{}{}
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	if ctx.ActiveProduct != "" {
		add("product/" + ctx.ActiveProduct)
	}
	if k := strings.TrimSpace(ctx.FocusKind); k != "" {
		add("focus/" + k)
	}
	if ctx.Database != "" {
		add("database/" + ctx.Database)
	}
	if ctx.Table != "" {
		add("table/" + ctx.Table)
	}
	if nid := strings.TrimSpace(ctx.NoteID); nid != "" {
		add("notebook/" + nid)
	}
	for _, m := range ctx.Mentions {
		if m.Kind != "" {
			add(m.Kind + "/" + m.ID)
		}
	}
	if ctx.ConnectionID != "" {
		add("database/" + ctx.ConnectionID)
	}
	return out
}
