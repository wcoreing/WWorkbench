package notebook

import (
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/model"
)

// TaskLogFile 任务步骤文本日志文件名（与 SKILL.md 同目录）。
const TaskLogFile = "log.md"

// TaskLogNoteID 工作流/{name}/log.md。
func TaskLogNoteID(skillName string) string {
	skillName = strings.Trim(strings.TrimSpace(strings.ReplaceAll(skillName, "\\", "/")), "/")
	if skillName == "" {
		return ""
	}
	if i := strings.IndexByte(skillName, '/'); i >= 0 {
		skillName = skillName[:i]
	}
	return SkillGroupName + "/" + skillName + "/" + TaskLogFile
}

// SanitizeSkillDirName 目录名：保留中文，去掉路径分隔与首尾点空白。
func SanitizeSkillDirName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.ReplaceAll(name, "\\", "-")
	name = strings.ReplaceAll(name, "/", "-")
	name = strings.Trim(name, ". \t")
	if name == "" || name == "." || name == ".." {
		return ""
	}
	if len([]rune(name)) > 64 {
		r := []rune(name)
		name = string(r[:64])
	}
	return name
}

// FormatTaskLogMarkdown 将任务步骤格式化为可读文本（非结构化表）。
func FormatTaskLogMarkdown(run model.TaskRunDO, steps []model.TaskStepDO) string {
	var b strings.Builder
	title := strings.TrimSpace(run.Title)
	if title == "" {
		title = run.Session
	}
	if title == "" {
		title = run.ID
	}
	b.WriteString("# 日志 · ")
	b.WriteString(title)
	b.WriteByte('\n')
	b.WriteByte('\n')
	b.WriteString(fmt.Sprintf("- runId: `%s`\n", run.ID))
	if s := strings.TrimSpace(run.Session); s != "" {
		b.WriteString(fmt.Sprintf("- session: %s\n", s))
	}
	if s := strings.TrimSpace(run.Status); s != "" {
		b.WriteString(fmt.Sprintf("- status: %s\n", s))
	}
	if s := strings.TrimSpace(run.Source); s != "" {
		b.WriteString(fmt.Sprintf("- source: %s\n", s))
	}
	if s := strings.TrimSpace(run.Intent); s != "" {
		b.WriteString(fmt.Sprintf("- intent: %s\n", s))
	}
	b.WriteString(fmt.Sprintf("- updated: %s\n", time.Now().Format("2006-01-02 15:04:05")))
	b.WriteByte('\n')
	if len(steps) == 0 {
		b.WriteString("## 思考\n\n（暂无）\n\n## 操作\n\n（暂无步骤）\n")
		return b.String()
	}
	var thoughts, ops []model.TaskStepDO
	for _, st := range steps {
		if strings.TrimSpace(st.Kind) == model.TaskStepKindThought {
			thoughts = append(thoughts, st)
		} else {
			ops = append(ops, st)
		}
	}
	b.WriteString("## 思考\n\n")
	if len(thoughts) == 0 {
		b.WriteString("（暂无）\n")
	} else {
		for _, st := range thoughts {
			line := strings.TrimSpace(st.Summary)
			if line == "" {
				line = strings.TrimSpace(st.Intent)
			}
			if line == "" {
				line = st.Action
			}
			prov := strings.TrimSpace(st.Provider)
			if prov != "" {
				b.WriteString(fmt.Sprintf("%d. [%s] %s\n", st.Seq, prov, line))
			} else {
				b.WriteString(fmt.Sprintf("%d. %s\n", st.Seq, line))
			}
		}
	}
	b.WriteByte('\n')
	b.WriteString("## 操作\n\n")
	if len(ops) == 0 {
		b.WriteString("（暂无步骤）\n")
	} else {
		for _, st := range ops {
			mark := "ok"
			if !st.OK {
				mark = "FAIL"
			}
			line := strings.TrimSpace(st.Intent)
			if line == "" {
				line = strings.TrimSpace(st.Summary)
			}
			if line == "" {
				line = st.Action
			}
			prov := strings.TrimSpace(st.Provider)
			head := fmt.Sprintf("%d. [%s] %s — %s", st.Seq, mark, st.Action, line)
			if prov != "" {
				head = fmt.Sprintf("%d. [%s/%s] %s — %s", st.Seq, mark, prov, st.Action, line)
			}
			b.WriteString(head)
			b.WriteByte('\n')
			if hint := taskStepLocatorHint(st.Locator); hint != "" {
				b.WriteString(fmt.Sprintf("   - target: %s\n", hint))
			}
			if !st.OK && strings.TrimSpace(st.Error) != "" {
				b.WriteString(fmt.Sprintf("   - error: %s\n", strings.TrimSpace(st.Error)))
			}
		}
	}
	b.WriteByte('\n')
	return b.String()
}

func taskStepLocatorHint(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return ""
	}
	// 轻量抽取，避免引依赖 encoding/json 的复杂结构
	for _, key := range []string{`"name":`, `"selector":`, `"url":`, `"ref":`} {
		if i := strings.Index(raw, key); i >= 0 {
			rest := raw[i+len(key):]
			rest = strings.TrimLeft(rest, " \"")
			end := strings.IndexAny(rest, `",}`)
			if end > 0 {
				return strings.TrimSpace(rest[:end])
			}
		}
	}
	if len(raw) > 120 {
		return raw[:120] + "…"
	}
	return raw
}

// SyncTaskRunLog 把任务步骤写入 工作流/{name}/log.md；返回 noteId 与 skill 目录相对路径。
// 已有 log 时只更新头信息并追加更高 seq 的思考/操作，不整文件覆盖（保留人工批注与既有条目）。
func (s *Service) SyncTaskRunLog(skillName string, run model.TaskRunDO, steps []model.TaskStepDO) (noteID, scopeRoot string, err error) {
	if s == nil {
		return "", "", errnoNotebook("笔记本未就绪")
	}
	skillName = SanitizeSkillDirName(skillName)
	if skillName == "" {
		skillName = SanitizeSkillDirName(run.Title)
	}
	if skillName == "" {
		skillName = "run-" + strings.TrimSpace(run.ID)
		if len(skillName) > 16 {
			skillName = skillName[:16]
		}
	}
	if err := s.EnsureSkillGroup(); err != nil {
		return "", "", err
	}
	parent := SkillGroupName + "/" + skillName
	noteID = TaskLogNoteID(skillName)
	prev := ""
	if old, gerr := s.GetNote(noteID); gerr == nil && old != nil {
		prev = old.Content
	}
	content := MergeTaskLogMarkdown(prev, run, steps)
	n := model.NoteDO{
		ID:       noteID,
		GroupID:  parent,
		Title:    "log",
		Content:  content,
		Language: "markdown",
		Role:     model.NoteRoleNote,
	}
	saved, err := s.SaveNote(n)
	if err != nil {
		return "", "", err
	}
	return saved.ID, parent, nil
}

// MergeTaskLogMarkdown 增量合并：无旧文则全量格式化；有旧文则刷新头信息并只追加更高 seq 的条目。
func MergeTaskLogMarkdown(prev string, run model.TaskRunDO, steps []model.TaskStepDO) string {
	prev = strings.TrimSpace(prev)
	if prev == "" || !strings.Contains(prev, "## 操作") {
		return FormatTaskLogMarkdown(run, steps)
	}
	maxThought, maxOp := maxTaskLogSeqs(prev)
	var newThoughts, newOps []model.TaskStepDO
	for _, st := range steps {
		if strings.TrimSpace(st.Kind) == model.TaskStepKindThought {
			if st.Seq > maxThought {
				newThoughts = append(newThoughts, st)
			}
			continue
		}
		if st.Seq > maxOp {
			newOps = append(newOps, st)
		}
	}
	out := patchTaskLogHeader(prev, run)
	if len(newThoughts) == 0 && len(newOps) == 0 {
		return out
	}
	if len(newThoughts) > 0 {
		out = appendTaskLogSection(out, "## 思考", formatTaskThoughtLines(newThoughts))
	}
	if len(newOps) > 0 {
		out = appendTaskLogSection(out, "## 操作", formatTaskOpLines(newOps))
	}
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return out
}

func maxTaskLogSeqs(content string) (maxThought, maxOp int) {
	inThought, inOp := false, false
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "## 思考") {
			inThought, inOp = true, false
			continue
		}
		if strings.HasPrefix(trim, "## 操作") {
			inThought, inOp = false, true
			continue
		}
		if strings.HasPrefix(trim, "## ") {
			inThought, inOp = false, false
			continue
		}
		seq := parseLeadingSeq(trim)
		if seq <= 0 {
			continue
		}
		if inThought && seq > maxThought {
			maxThought = seq
		}
		if inOp && seq > maxOp {
			maxOp = seq
		}
	}
	return maxThought, maxOp
}

func parseLeadingSeq(line string) int {
	// "12. …" / "12. [ok/wwb] …"
	dot := strings.IndexByte(line, '.')
	if dot <= 0 {
		return 0
	}
	n := 0
	for i := 0; i < dot; i++ {
		c := line[i]
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func patchTaskLogHeader(prev string, run model.TaskRunDO) string {
	lines := strings.Split(prev, "\n")
	title := strings.TrimSpace(run.Title)
	if title == "" {
		title = run.Session
	}
	if title == "" {
		title = run.ID
	}
	out := make([]string, 0, len(lines)+4)
	headerDone := false
	i := 0
	if i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), "# 日志") {
		out = append(out, "# 日志 · "+title)
		i++
	}
	for i < len(lines) {
		line := lines[i]
		trim := strings.TrimSpace(line)
		if !headerDone {
			if strings.HasPrefix(trim, "## ") {
				headerDone = true
				out = append(out, line)
				i++
				continue
			}
			if strings.HasPrefix(trim, "- runId:") {
				out = append(out, fmt.Sprintf("- runId: `%s`", run.ID))
				i++
				continue
			}
			if strings.HasPrefix(trim, "- session:") {
				if s := strings.TrimSpace(run.Session); s != "" {
					out = append(out, "- session: "+s)
				}
				i++
				continue
			}
			if strings.HasPrefix(trim, "- status:") {
				if s := strings.TrimSpace(run.Status); s != "" {
					out = append(out, "- status: "+s)
				}
				i++
				continue
			}
			if strings.HasPrefix(trim, "- source:") {
				if s := strings.TrimSpace(run.Source); s != "" {
					out = append(out, "- source: "+s)
				}
				i++
				continue
			}
			if strings.HasPrefix(trim, "- intent:") {
				if s := strings.TrimSpace(run.Intent); s != "" {
					out = append(out, "- intent: "+s)
				}
				i++
				continue
			}
			if strings.HasPrefix(trim, "- updated:") {
				out = append(out, fmt.Sprintf("- updated: %s", time.Now().Format("2006-01-02 15:04:05")))
				i++
				continue
			}
		}
		out = append(out, line)
		i++
	}
	return strings.Join(out, "\n")
}

func formatTaskThoughtLines(thoughts []model.TaskStepDO) string {
	var b strings.Builder
	for _, st := range thoughts {
		line := strings.TrimSpace(st.Summary)
		if line == "" {
			line = strings.TrimSpace(st.Intent)
		}
		if line == "" {
			line = st.Action
		}
		prov := strings.TrimSpace(st.Provider)
		if prov != "" {
			b.WriteString(fmt.Sprintf("%d. [%s] %s\n", st.Seq, prov, line))
		} else {
			b.WriteString(fmt.Sprintf("%d. %s\n", st.Seq, line))
		}
	}
	return b.String()
}

func formatTaskOpLines(ops []model.TaskStepDO) string {
	var b strings.Builder
	for _, st := range ops {
		mark := "ok"
		if !st.OK {
			mark = "FAIL"
		}
		line := strings.TrimSpace(st.Intent)
		if line == "" {
			line = strings.TrimSpace(st.Summary)
		}
		if line == "" {
			line = st.Action
		}
		prov := strings.TrimSpace(st.Provider)
		head := fmt.Sprintf("%d. [%s] %s — %s", st.Seq, mark, st.Action, line)
		if prov != "" {
			head = fmt.Sprintf("%d. [%s/%s] %s — %s", st.Seq, mark, prov, st.Action, line)
		}
		b.WriteString(head)
		b.WriteByte('\n')
		if hint := taskStepLocatorHint(st.Locator); hint != "" {
			b.WriteString(fmt.Sprintf("   - target: %s\n", hint))
		}
		if !st.OK && strings.TrimSpace(st.Error) != "" {
			b.WriteString(fmt.Sprintf("   - error: %s\n", strings.TrimSpace(st.Error)))
		}
	}
	return b.String()
}

func appendTaskLogSection(doc, heading, addition string) string {
	addition = strings.TrimRight(addition, "\n") + "\n"
	idx := strings.Index(doc, heading)
	if idx < 0 {
		if !strings.HasSuffix(doc, "\n") {
			doc += "\n"
		}
		return doc + "\n" + heading + "\n\n" + addition
	}
	rest := doc[idx+len(heading):]
	// 跳过 heading 后空行
	next := strings.Index(rest, "\n## ")
	if next < 0 {
		body := strings.TrimRight(rest, "\n")
		// 去掉占位「（暂无）」后追加
		body = strings.TrimSuffix(strings.TrimSpace(body), "（暂无）")
		body = strings.TrimSuffix(strings.TrimSpace(body), "（暂无步骤）")
		if body != "" && !strings.HasSuffix(body, "\n") {
			body += "\n"
		}
		return doc[:idx] + heading + "\n\n" + strings.TrimLeft(body, "\n") + addition
	}
	body := rest[:next]
	body = strings.TrimSuffix(strings.TrimSpace(body), "（暂无）")
	body = strings.TrimSuffix(strings.TrimSpace(body), "（暂无步骤）")
	if body != "" && !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	return doc[:idx] + heading + "\n\n" + strings.TrimLeft(body, "\n") + addition + rest[next:]
}
