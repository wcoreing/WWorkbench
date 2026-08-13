package turnctx

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/model"
)

const maxSnapshotRunes = 4200

// Gather 组装本轮 TurnSnapshot 文本（进 feedforward，不污染旧历史 content）。
func Gather(ctx model.AgentContextDO) string {
	var b strings.Builder
	b.WriteString("【本轮工作台现状】\n")
	if ctx.ActiveProduct != "" {
		fmt.Fprintf(&b, "- 当前产品线: %s\n", ctx.ActiveProduct)
	}
	if ctx.ConnectionID != "" {
		fmt.Fprintf(&b, "- 数据库连接 connectionId=%s", ctx.ConnectionID)
		if ctx.Database != "" {
			fmt.Fprintf(&b, " database=%s", ctx.Database)
		}
		if ctx.SessionID != "" {
			fmt.Fprintf(&b, " sessionId=%s", ctx.SessionID)
		}
		b.WriteByte('\n')
	}
	if len(ctx.Mentions) > 0 {
		b.WriteString("- 本轮 @ 绑定（优先使用，勿编造 ID）:\n")
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

// FocusRefFromContext 推导 sessions.focus_ref。
func FocusRefFromContext(ctx model.AgentContextDO) string {
	for _, m := range ctx.Mentions {
		switch m.Kind {
		case "ssh":
			return "ssh:" + m.ID
		case "database":
			return "db:" + m.ID
		case "docker":
			return "docker:" + m.ID
		}
	}
	if ctx.ConnectionID != "" {
		return "db:" + ctx.ConnectionID
	}
	return ""
}

// SkillPathsFromContext 推导本轮 Skill 匹配路径（产品线 / @绑定）。
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
