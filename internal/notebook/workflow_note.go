package notebook

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/skill/docfmt"

	"gopkg.in/yaml.v3"
)

var skillStepsFenceRE = regexp.MustCompile("(?s)```wwb-skill-steps\\s*\\n(.*?)\\n```")

// WorkflowNoteBodyExtras 兼容别名 → skill/docfmt.BodyExtras。
type WorkflowNoteBodyExtras = docfmt.BodyExtras

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

// ExtractWorkflowNoteBodyExtras 委托 docfmt。
func ExtractWorkflowNoteBodyExtras(content string) WorkflowNoteBodyExtras {
	return docfmt.ExtractBodyExtras(content)
}

// SkillResourceKinds 兼容常量。
const (
	SkillResourceKindScreenshot = docfmt.ResourceKindScreenshot
	SkillResourceKindFile       = docfmt.ResourceKindFile
	SkillResourceKindTemplate   = docfmt.ResourceKindTemplate
	SkillResourceKindConfig     = docfmt.ResourceKindConfig
)

// FormatSkillResourceLine 委托 docfmt。
func FormatSkillResourceLine(kind, label, markdown string) string {
	return docfmt.FormatResourceLine(kind, label, markdown)
}

// DefaultSkillScriptsPlaceholder 委托 docfmt。
func DefaultSkillScriptsPlaceholder() string {
	return docfmt.DefaultScriptsPlaceholder()
}

// DefaultSkillResourcesPlaceholder 委托 docfmt。
func DefaultSkillResourcesPlaceholder(noteID string) string {
	return docfmt.DefaultResourcesPlaceholder(noteID)
}

// FormatWorkflowNoteContent 委托 docfmt；短名空 NoteID 时补产品默认路径 工作流/…。
func FormatWorkflowNoteContent(p model.WorkflowDO, extras WorkflowNoteBodyExtras) string {
	if strings.TrimSpace(p.NoteID) == "" {
		p.NoteID = SkillNoteID(strings.TrimSpace(p.Name))
	}
	return docfmt.Format(p, extras)
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
// name 可为短名（默认落 工作流/）或完整目录路径（如 记忆区/主机/项目/dwq）。
func (s *Service) SaveWorkflowNoteWithExtras(p model.WorkflowDO, extras WorkflowNoteBodyExtras) (model.WorkflowDO, error) {
	if s == nil || s.dataDir == "" {
		return p, fmt.Errorf("笔记本未就绪")
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return p, fmt.Errorf("工作流 name 不能为空")
	}
	if err := s.EnsureWorkspace(); err != nil {
		return p, err
	}
	_ = s.ensureSystemDirs()
	id := strings.TrimSpace(p.NoteID)
	if id == "" || !isSkillPathID(id) {
		id = SkillNoteID(name)
	}
	existing, _ := s.GetNote(id)
	if existing == nil {
		// 短名可能已在记忆区等处成册：复用已有路径，避免再造 工作流/ 副本
		if found := s.FindNoteIDBySkillID(name); found != "" && isSkillPathID(found) {
			id = found
			existing, _ = s.GetNote(id)
		}
	}
	merged := WorkflowNoteBodyExtras{}
	if existing != nil {
		merged = ExtractWorkflowNoteBodyExtras(existing.Content)
		id = existing.ID
	}
	if strings.TrimSpace(extras.Lessons) != "" {
		merged.Lessons = strings.TrimSpace(extras.Lessons)
	}
	if strings.TrimSpace(extras.TrustedOps) != "" {
		merged.TrustedOps = strings.TrimSpace(extras.TrustedOps)
	}
	if strings.TrimSpace(extras.Scripts) != "" {
		merged.Scripts = strings.TrimSpace(extras.Scripts)
	}
	if strings.TrimSpace(extras.Resources) != "" {
		merged.Resources = strings.TrimSpace(extras.Resources)
	}
	content := FormatWorkflowNoteContent(p, merged)
	title := firstNonEmptyStr(strings.TrimSpace(p.Title), SkillBasename(id), name)
	groupID := SkillDirFromNoteID(id)
	note := model.NoteDO{
		ID:       id,
		GroupID:  groupID,
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
		pinMsg = "update_skill"
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
