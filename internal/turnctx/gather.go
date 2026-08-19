package turnctx

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/model"
)

const (
	maxSnapshotRunes  = 4200
	maxTabsBrief      = 280
	maxFocusLabel     = 120
	maxShellTailRunes = 18000
)

// Gather 组装本轮界面快照（Turn Transport）进 feedforward，与界面一致；细节用工具核实。
func Gather(ctx model.AgentContextDO) string {
	var b strings.Builder
	b.WriteString("## 工作台现状（Turn Transport · 与界面一致；当前 Shell 最近输出已附上）\n")
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
		b.WriteString("\n- 用户说「这篇 / 当前笔记 / 打开的笔记」时用 get_note(noteId)；笔记在工作台库内，禁止 cat 文件，禁止 recall_resource。\n")
	}
	if ot := strings.TrimSpace(ctx.OpenTabsBrief); ot != "" {
		fmt.Fprintf(&b, "- **中栏标签**：%s\n", trimBrief(ot, maxTabsBrief))
	}
	if sel := strings.TrimSpace(ctx.SelectionBrief); sel != "" {
		fmt.Fprintf(&b, "- **树/资源选中**：%s\n", trimBrief(sel, 160))
	}

	if len(ctx.Mentions) > 0 {
		b.WriteString("- **本轮 @ 绑定**（优先使用，勿编造 ID）:\n")
		for _, m := range ctx.Mentions {
			switch m.Kind {
			case "ssh":
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
	b.WriteString("- 容器启停/删除用 start_container / stop_container / remove_container（会确认）；terminal_exec 为 argv 安全模式（python -c 分号写在引号内；管道用 terminal_open）。\n")
	b.WriteString("- 资产落盘：HTTP→save_http_request+save_http_environment；SSH→save_ssh_host/save_ssh_forward；库→save_connection；日志→save_log_source；Docker→save_docker_context。\n")
	out := b.String()
	if utf8.RuneCountInString(out) > maxSnapshotRunes {
		r := []rune(out)
		out = string(r[:maxSnapshotRunes]) + "\n…"
	}
	if tail := strings.TrimSpace(ctx.ShellTail); tail != "" {
		tail = trimTailEnd(tail, maxShellTailRunes)
		fence := "```"
		if strings.Contains(tail, "```") {
			fence = "````"
		}
		var sb strings.Builder
		sb.WriteString(out)
		sb.WriteString("\n### 当前 Shell 最近输出（与终端面板一致，最多约 100 行）\n")
		if sid := strings.TrimSpace(ctx.TerminalSessionID); sid != "" {
			fmt.Fprintf(&sb, "- terminalSessionId=`%s`\n", sid)
		}
		sb.WriteString("- 用户问「跑完了吗 / 报错 / 装好了吗 / 这段输出」时直接引用下面内容，不要为了看屏幕再 terminal_exec / terminal_open。\n")
		sb.WriteString("- 若要刷新或跑新命令再用工具；terminal_open 注入后输出仍在面板，下一轮用户消息才会带上最新 100 行。\n")
		sb.WriteString(fence)
		sb.WriteByte('\n')
		sb.WriteString(tail)
		sb.WriteByte('\n')
		sb.WriteString(fence)
		sb.WriteByte('\n')
		out = sb.String()
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

func trimTailEnd(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return "…\n" + string(r[len(r)-max:])
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
