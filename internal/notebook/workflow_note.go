package notebook

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"WWorkbench/internal/model"

	"gopkg.in/yaml.v3"
)

var (
	skillStepsFenceRE = regexp.MustCompile("(?s)```wwb-skill-steps\\s*\\n(.*?)\\n```")
	sectionRE         = regexp.MustCompile(`(?m)^##\s+(.+?)\s*$`)
)

// WorkflowNoteBodyExtras 工作流笔记中除步骤外的可沉淀段落（保存步骤时须保留）。
type WorkflowNoteBodyExtras struct {
	Lessons   string // ## 经验 正文（不含标题）
	Scripts   string // ## 脚本 正文
	Resources string // ## 资源 正文
}

type workflowFrontmatter struct {
	Role        string `yaml:"role,omitempty"`
	Name        string `yaml:"name,omitempty"`
	SkillID     string `yaml:"skillId,omitempty"`
	Session     string `yaml:"session,omitempty"`
	SourceRunID string `yaml:"sourceRunId,omitempty"`
	Intent      string `yaml:"intent,omitempty"`
	Description string `yaml:"description,omitempty"`
	Bind        string `yaml:"bind,omitempty"`
}

// SkillNoteID 工作流笔记 id = 磁盘相对路径 工作流/{name}/SKILL.md。
func SkillNoteID(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	name = strings.TrimSuffix(name, "/"+SkillEntryFile)
	name = strings.TrimPrefix(name, SkillGroupName+"/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	if name == "" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	return SkillGroupName + "/" + name + "/" + SkillEntryFile
}

// SkillNameFromNoteID 从 SKILL.md 路径还原 skill name。
// 仅认 工作流/{name}/SKILL.md；同目录 log.md / 其它文件返回空（避免 get_skill 误读日志）。
func SkillNameFromNoteID(id string) string {
	id = strings.TrimSpace(strings.ReplaceAll(id, "\\", "/"))
	if id == "" {
		return ""
	}
	lower := strings.ToLower(id)
	suffix := "/" + strings.ToLower(SkillEntryFile)
	if !strings.HasSuffix(lower, suffix) {
		return ""
	}
	id = id[:len(id)-len(suffix)]
	if !strings.HasPrefix(id, SkillGroupName+"/") {
		return ""
	}
	rest := strings.TrimPrefix(id, SkillGroupName+"/")
	if rest == "" || strings.Contains(rest, "/") {
		return ""
	}
	return rest
}

// IsTaskLogNoteID 是否为任务账本投影路径 工作流/{name}/log.md。
func IsTaskLogNoteID(id string) bool {
	id = strings.TrimSpace(strings.ReplaceAll(id, "\\", "/"))
	if id == "" {
		return false
	}
	lower := strings.ToLower(id)
	return strings.HasPrefix(id, SkillGroupName+"/") &&
		strings.HasSuffix(lower, "/"+strings.ToLower(TaskLogFile))
}

// ExtractWorkflowNoteBodyExtras 从已有笔记抽出经验/脚本/资源段落，避免 save 步骤时冲掉沉淀。
func ExtractWorkflowNoteBodyExtras(content string) WorkflowNoteBodyExtras {
	_, body, ok := splitWorkflowFrontmatter(content)
	if !ok {
		body = content
	}
	return WorkflowNoteBodyExtras{
		Lessons:   extractMarkdownSection(body, "经验"),
		Scripts:   extractMarkdownSection(body, "脚本"),
		Resources: extractMarkdownSection(body, "资源"),
	}
}

func extractMarkdownSection(body, title string) string {
	idxs := sectionRE.FindAllStringSubmatchIndex(body, -1)
	if len(idxs) == 0 {
		return ""
	}
	for i, m := range idxs {
		name := strings.TrimSpace(body[m[2]:m[3]])
		if name != title {
			continue
		}
		start := m[1]
		end := len(body)
		if i+1 < len(idxs) {
			end = idxs[i+1][0]
		}
		return strings.TrimSpace(body[start:end])
	}
	return ""
}

// SkillResourceKinds 资源 kind 约定（登记在 ## 资源；二进制落 Skill 目录 assets/）。
const (
	SkillResourceKindScreenshot = "screenshot"
	SkillResourceKindFile       = "file"
	SkillResourceKindTemplate   = "template"
	SkillResourceKindConfig     = "config"
)

// FormatSkillResourceLine 统一资源索引行：kind · 说明 · markdown 链接（必须指向本笔记附件 URL）。
func FormatSkillResourceLine(kind, label, markdown string) string {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = SkillResourceKindFile
	}
	label = strings.TrimSpace(label)
	markdown = strings.TrimSpace(markdown)
	if label == "" {
		return fmt.Sprintf("- kind: %s · %s", kind, markdown)
	}
	return fmt.Sprintf("- kind: %s · %s · %s", kind, label, markdown)
}

// DefaultSkillScriptsPlaceholder ## 脚本 空态（正文围栏 + 可选同级 scripts/）。
func DefaultSkillScriptsPlaceholder() string {
	return "（无脚本。沉淀：`update_skill(script=…)`；shell/SQL 围栏写在「## 脚本」，或落同级 `scripts/`；给人核对，经工作台确认后再跑。）"
}

// DefaultSkillResourcesPlaceholder ## 资源 空态（附件统一落本笔记目录）。
func DefaultSkillResourcesPlaceholder(noteID string) string {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		noteID = "工作流/{name}/SKILL.md"
	}
	return fmt.Sprintf(
		"> 附件真源：本 Skill 目录下 assets/（与 SKILL.md 同级）。正文用相对链接 assets/文件名。\n\n"+
			"（无附件。update_skill(resourcePaths=…) 或「插入附件」→ 写入 assets/ 并按 kind · 说明 · 链接 登记。noteId=%s）",
		noteID,
	)
}

// FormatWorkflowNoteContent 将工作流写成标准 Skill Markdown。
// 结构固定：frontmatter → 说明 → 经验 → 步骤(+wwb-skill-steps) → 脚本 → 资源。
// 脚本在「## 脚本」或 scripts/；二进制在同级 assets/，由 ## 资源索引。
func FormatWorkflowNoteContent(p model.WorkflowDO, extras WorkflowNoteBodyExtras) string {
	name := strings.TrimSpace(p.Name)
	noteID := firstNonEmptyStr(strings.TrimSpace(p.NoteID), SkillNoteID(name))
	fm := workflowFrontmatter{
		Role:        model.NoteRoleSkill,
		Name:        name,
		SkillID:     name,
		SourceRunID: strings.TrimSpace(p.SourceRunID),
		Intent:      strings.TrimSpace(p.Intent),
		Description: strings.TrimSpace(p.Description),
		Bind:        "browser",
	}
	if sess := sessionFromSteps(p.Steps); sess != "" {
		fm.Session = sess
	}
	raw, _ := yaml.Marshal(fm)
	block := strings.TrimRight(string(raw), "\n")

	title := firstNonEmptyStr(strings.TrimSpace(p.Title), p.Name)
	var body strings.Builder
	fmt.Fprintf(&body, "<!-- wwb-skill: %s -->\n\n", name)
	fmt.Fprintf(&body, "# %s\n\n", title)
	if d := strings.TrimSpace(p.Description); d != "" {
		body.WriteString(d)
		body.WriteString("\n\n")
	}
	if intent := strings.TrimSpace(p.Intent); intent != "" {
		fmt.Fprintf(&body, "> 意图：%s\n\n", intent)
	}
	body.WriteString("## 说明\n\n")
	body.WriteString("本笔记是 **Agent Skill**（引擎=Agent；步骤=可选提示）。\n\n")
	fmt.Fprintf(&body, "- 读：`get_skill(skill=%s)` → 用工具完成目标\n", name)
	body.WriteString("- 沉淀：`update_skill` 写回经验 / 步骤 / 脚本 / 资源\n")
	body.WriteString("- 资源：二进制挂本 Skill 目录 `assets/`；脚本写在「## 脚本」或 `scripts/`\n")
	fmt.Fprintf(&body, "- 可选：`run_skill(name=%s)`（机械逐步，失败即停）\n\n", name)

	lessons := strings.TrimSpace(extras.Lessons)
	if lessons == "" {
		lessons = "（尚无沉淀；跑通或踩坑后 `update_skill(lessons=…)` 追加。）"
	}
	body.WriteString("## 经验\n\n")
	body.WriteString(lessons)
	body.WriteString("\n\n")

	body.WriteString("## 步骤\n\n")
	for i, st := range p.Steps {
		sum := firstNonEmptyStr(st.Summary, st.Action)
		if st.Action == "pause" || st.Action == "coach" {
			fmt.Fprintf(&body, "%d. **pause** — %s\n", i+1, sum)
		} else {
			fmt.Fprintf(&body, "%d. `%s` — %s\n", i+1, st.Action, sum)
		}
	}
	body.WriteString("\n可执行步骤：\n\n")
	stepsJSON, err := json.MarshalIndent(p.Steps, "", "  ")
	if err != nil {
		stepsJSON = []byte("[]")
	}
	body.WriteString("```wwb-skill-steps\n")
	body.Write(stepsJSON)
	body.WriteString("\n```\n\n")

	scripts := strings.TrimSpace(extras.Scripts)
	if scripts == "" {
		scripts = DefaultSkillScriptsPlaceholder()
	}
	body.WriteString("## 脚本\n\n")
	body.WriteString(scripts)
	body.WriteString("\n\n")

	resources := strings.TrimSpace(extras.Resources)
	if resources == "" {
		resources = DefaultSkillResourcesPlaceholder(noteID)
	}
	body.WriteString("## 资源\n\n")
	body.WriteString(resources)
	body.WriteString("\n")

	return "---\n" + block + "\n---\n\n" + body.String()
}

// ParseWorkflowNote 从笔记还原 WorkflowDO；失败返回 ok=false。
func ParseWorkflowNote(n model.NoteDO) (model.WorkflowDO, bool) {
	role := NormalizeNoteRole(n.Role)
	fm, body, hasFM := splitWorkflowFrontmatter(n.Content)
	if hasFM && strings.TrimSpace(fm.Role) != "" {
		role = NormalizeNoteRole(fm.Role)
	}
	isWorkflow := role == model.NoteRoleSkill || isSkillPathID(n.ID) ||
		skillStepsFenceRE.MatchString(n.Content)
	if !isWorkflow {
		return model.WorkflowDO{}, false
	}
	name := strings.TrimSpace(fm.Name)
	if name == "" {
		name = strings.TrimSpace(fm.SkillID)
	}
	if name == "" {
		name = SkillNameFromNoteID(n.ID)
	}
	if name == "" {
		name = slugFromTitle(n.Title)
	}
	steps := parseWorkflowStepsFence(n.Content)
	if steps == nil {
		steps = []model.WorkflowStepDO{}
	}
	title := strings.TrimSpace(n.Title)
	if title == "" {
		title = extractH1(body)
	}
	if title == "" {
		title = name
	}
	desc := strings.TrimSpace(fm.Description)
	if desc == "" {
		desc = extractLeadParagraph(body)
	}
	return model.WorkflowDO{
		ID:          n.ID,
		Name:        name,
		Title:       title,
		Description: desc,
		Intent:      strings.TrimSpace(fm.Intent),
		Steps:       steps,
		SourceRunID: strings.TrimSpace(fm.SourceRunID),
		NoteID:      n.ID,
		Source:      "note",
		CreatedAt:   n.CreatedAt,
		UpdatedAt:   n.UpdatedAt,
	}, true
}

func parseWorkflowStepsFence(content string) []model.WorkflowStepDO {
	m := skillStepsFenceRE.FindStringSubmatch(content)
	if len(m) < 2 {
		return nil
	}
	var steps []model.WorkflowStepDO
	if err := json.Unmarshal([]byte(strings.TrimSpace(m[1])), &steps); err != nil {
		return nil
	}
	if steps == nil {
		return []model.WorkflowStepDO{}
	}
	return steps
}

func splitWorkflowFrontmatter(content string) (workflowFrontmatter, string, bool) {
	s := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(s, "---") {
		return workflowFrontmatter{}, content, false
	}
	rest := s[3:]
	if len(rest) == 0 || (rest[0] != '\n' && rest[0] != '\r') {
		return workflowFrontmatter{}, content, false
	}
	rest = strings.TrimPrefix(rest, "\r\n")
	rest = strings.TrimPrefix(rest, "\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return workflowFrontmatter{}, content, false
	}
	raw := rest[:end]
	body := rest[end+4:]
	body = strings.TrimPrefix(body, "\r\n")
	body = strings.TrimPrefix(body, "\n")
	var fm workflowFrontmatter
	if err := yaml.Unmarshal([]byte(raw), &fm); err != nil {
		return workflowFrontmatter{}, content, false
	}
	return fm, body, true
}

func sessionFromSteps(steps []model.WorkflowStepDO) string {
	for _, st := range steps {
		if st.Args == nil {
			continue
		}
		if v, ok := st.Args["session"].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func extractH1(body string) string {
	for _, ln := range strings.Split(body, "\n") {
		ln = strings.TrimSpace(ln)
		if strings.HasPrefix(ln, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(ln, "# "))
		}
	}
	return ""
}

func extractLeadParagraph(body string) string {
	var lines []string
	started := false
	for _, ln := range strings.Split(body, "\n") {
		trim := strings.TrimSpace(ln)
		if strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, "```") || strings.HasPrefix(trim, ">") {
			if started {
				break
			}
			continue
		}
		if trim == "" {
			if started {
				break
			}
			continue
		}
		started = true
		lines = append(lines, trim)
		if len(lines) >= 3 {
			break
		}
	}
	return strings.Join(lines, " ")
}

func slugFromTitle(title string) string {
	title = strings.ToLower(strings.TrimSpace(title))
	var b strings.Builder
	prev := false
	for _, r := range title {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prev = false
			continue
		}
		if !prev && b.Len() > 0 {
			b.WriteByte('-')
			prev = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "workflow"
	}
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// SaveWorkflowNote 以笔记为 SSOT 保存工作流（id=工作流/{name}/SKILL.md）；保留已有经验/脚本/资源。
func (s *Service) SaveWorkflowNote(p model.WorkflowDO) (model.WorkflowDO, error) {
	return s.SaveWorkflowNoteWithExtras(p, WorkflowNoteBodyExtras{})
}

// SaveWorkflowNoteWithExtras 保存工作流；extras 非空字段覆盖，空字段则沿用笔记已有沉淀。
func (s *Service) SaveWorkflowNoteWithExtras(p model.WorkflowDO, extras WorkflowNoteBodyExtras) (model.WorkflowDO, error) {
	if s == nil || s.dataDir == "" {
		return p, fmt.Errorf("笔记本未就绪")
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return p, fmt.Errorf("工作流 name 不能为空")
	}
	if err := s.EnsureSkillGroup(); err != nil {
		return p, err
	}
	id := SkillNoteID(name)
	existing, _ := s.GetNote(id)
	merged := WorkflowNoteBodyExtras{}
	if existing != nil {
		merged = ExtractWorkflowNoteBodyExtras(existing.Content)
	}
	if strings.TrimSpace(extras.Lessons) != "" {
		merged.Lessons = strings.TrimSpace(extras.Lessons)
	}
	if strings.TrimSpace(extras.Scripts) != "" {
		merged.Scripts = strings.TrimSpace(extras.Scripts)
	}
	if strings.TrimSpace(extras.Resources) != "" {
		merged.Resources = strings.TrimSpace(extras.Resources)
	}
	content := FormatWorkflowNoteContent(p, merged)
	title := firstNonEmptyStr(strings.TrimSpace(p.Title), name)
	note := model.NoteDO{
		ID:       id,
		GroupID:  SkillGroupName + "/" + name,
		Title:    title,
		Content:  content,
		Language: "markdown",
		Role:     model.NoteRoleSkill,
	}
	if existing != nil {
		note.SortOrder = existing.SortOrder
		note.CreatedAt = existing.CreatedAt
		note.SSHHostID = existing.SSHHostID
		note.ConnectionID = existing.ConnectionID
		if strings.TrimSpace(existing.GroupID) != "" {
			note.GroupID = existing.GroupID
		}
	}
	saved, err := s.SaveNote(note)
	if err != nil {
		return p, err
	}
	// 技能目录创建版本（gitignore 排除 log.md；内容未变则复用 HEAD）
	pinMsg := strings.TrimSpace(p.Source)
	if pinMsg == "" {
		pinMsg = "save_workflow"
	}
	if intent := strings.TrimSpace(p.Intent); intent != "" {
		pinMsg = pinMsg + ": " + intent
	}
	if _, pinErr := s.PinSkillVersion(name, pinMsg); pinErr != nil {
		// 创建版本失败不阻断写盘；可后续再创建
		_ = pinErr
	}
	out, ok := ParseWorkflowNote(*saved)
	if !ok {
		out = p
		out.ID = saved.ID
		out.NoteID = saved.ID
		out.Source = "note"
		out.UpdatedAt = saved.UpdatedAt
		out.CreatedAt = saved.CreatedAt
	}
	return out, nil
}

// GetWorkflowNote 按 name / noteId（工作流/{name}/SKILL.md）取工作流笔记。
func (s *Service) GetWorkflowNote(idOrName string) (model.WorkflowDO, error) {
	idOrName = strings.TrimSpace(idOrName)
	if idOrName == "" {
		return model.WorkflowDO{}, fmt.Errorf("工作流不存在")
	}
	tryIDs := []string{idOrName, SkillNoteID(idOrName)}
	for _, id := range tryIDs {
		n, err := s.GetNote(id)
		if err != nil || n == nil {
			continue
		}
		if p, ok := ParseWorkflowNote(*n); ok {
			return p, nil
		}
	}
	list, err := s.ListWorkflowNotes(80)
	if err != nil {
		return model.WorkflowDO{}, err
	}
	for _, p := range list {
		if p.Name == idOrName || p.NoteID == idOrName || p.ID == idOrName {
			return p, nil
		}
	}
	return model.WorkflowDO{}, fmt.Errorf("工作流不存在: %s", idOrName)
}

// ListWorkflowNotes 列出含可执行步骤的工作流笔记（role=skill 或 工作流/…/SKILL.md）。
func (s *Service) ListWorkflowNotes(limit int) ([]model.WorkflowDO, error) {
	if limit <= 0 {
		limit = 50
	}
	summaries, err := s.ListNotes()
	if err != nil {
		return nil, err
	}
	out := make([]model.WorkflowDO, 0)
	for _, sum := range summaries {
		if IsTaskLogNoteID(sum.ID) {
			continue
		}
		role := NormalizeNoteRole(sum.Role)
		if role != model.NoteRoleSkill && !isSkillPathID(sum.ID) {
			continue
		}
		n, err := s.GetNote(sum.ID)
		if err != nil || n == nil {
			continue
		}
		p, ok := ParseWorkflowNote(*n)
		if !ok {
			continue
		}
		out = append(out, p)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
