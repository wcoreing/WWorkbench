package turnctx

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/model"
)

const (
	maxSnapshotRunes = 4200
	maxTabsBrief     = 280
	maxFocusLabel    = 120
)

// Gather 组装本轮界面快照（Turn Transport）进 feedforward，与界面一致；细节用工具核实。
func Gather(ctx model.AgentContextDO) string {
	var b strings.Builder
	b.WriteString("## 工作台现状（Turn Transport · 与界面一致；细节用工具核实）\n")
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

	if tb := strings.TrimSpace(ctx.TabTitle); tb != "" {
		fmt.Fprintf(&b, "- **当前标签**：%s\n", trimBrief(tb, 80))
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
	b.WriteString("- terminal.exec 仅允许只读诊断命令；删除容器等请用对应 Docker 能力并经确认。\n")
	out := b.String()
	if utf8.RuneCountInString(out) > maxSnapshotRunes {
		r := []rune(out)
		out = string(r[:maxSnapshotRunes]) + "\n…"
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
