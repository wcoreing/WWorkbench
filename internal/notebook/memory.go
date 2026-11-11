package notebook

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/model"
)

const (
	// MemoryGroupName 记忆区目录名（分组 id 与目录名一致）。
	MemoryGroupName = "记忆区"
	// MemoryGroupID 与目录名相同。
	MemoryGroupID = MemoryGroupName
	// SeedMemoryNoteID 入门记忆笔记（相对工作区路径）。
	SeedMemoryNoteID = MemoryGroupName + "/怎么用记忆区.md"

	maxMemoryExcerptRunes = 160
)

// ContextHostIDs 从界面快照提取应匹配的 SSH/主机 id。
func ContextHostIDs(ctx model.AgentContextDO) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	add(ctx.HostID)
	for _, m := range ctx.Mentions {
		if m.Kind == "ssh" || m.Kind == "docker" {
			add(m.ID)
		}
	}
	// selectionBrief 形如 "ssh <id>" / "docker <id>" / "host <id>"
	brief := strings.ToLower(ctx.SelectionBrief)
	for _, prefix := range []string{"ssh ", "docker ", "host "} {
		if i := strings.Index(brief, prefix); i >= 0 {
			rest := strings.TrimSpace(ctx.SelectionBrief[i+len(prefix):])
			if tok := strings.Fields(rest); len(tok) > 0 {
				add(tok[0])
			}
		}
	}
	return out
}

// FormatMemoryFeedforward 把匹配的记忆笔记写入 Agent 前馈（只列索引+短摘录，不全文）。
func FormatMemoryFeedforward(notes []model.NoteSummaryDO, contents map[string]string) string {
	if len(notes) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("- **记忆区**（与当前焦点绑定的事实/坑；动手前先 get_note 读全文，勿凭印象改生产）:\n")
	for _, n := range notes {
		fmt.Fprintf(&b, "  · 「%s」 noteId=`%s`", trimRunes(n.Title, 48), n.ID)
		if n.SSHHostID != "" {
			fmt.Fprintf(&b, " ssh=`%s`", n.SSHHostID)
		}
		if n.ConnectionID != "" {
			fmt.Fprintf(&b, " db=`%s`", n.ConnectionID)
		}
		b.WriteByte('\n')
		if c, ok := contents[n.ID]; ok {
			if ex := memoryExcerpt(c); ex != "" {
				fmt.Fprintf(&b, "    摘录：%s\n", ex)
			}
		}
	}
	return b.String()
}

func memoryExcerpt(content string) string {
	_, body, has := splitFrontmatter(content)
	text := content
	if has {
		text = body
	}
	text = strings.TrimSpace(text)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(text, "\n")
	var parts []string
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "#") || strings.HasPrefix(ln, "<!--") {
			continue
		}
		parts = append(parts, ln)
		if len(parts) >= 2 {
			break
		}
	}
	joined := strings.Join(parts, " ")
	return trimRunes(joined, maxMemoryExcerptRunes)
}

func trimRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}

