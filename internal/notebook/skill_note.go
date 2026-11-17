package notebook

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"WWorkbench/internal/model"
)

const (
	// SkillGroupName 工作流目录名（磁盘真源；分组 id 与目录名一致，不做映射）。
	SkillGroupName = "工作流"
	// SkillGroupID 与目录名相同。
	SkillGroupID = SkillGroupName
)

var skillIDSuggestRE = regexp.MustCompile(`[^a-z0-9]+`)

// SkillBodyFromNote 从笔记正文提取可写入 SKILL.md 的 body（去标记与笔记 FM）。
func SkillBodyFromNote(content string) string {
	content = StripSkillMark(content)
	_, body, ok := splitFrontmatterMap(content)
	if ok {
		content = body
	}
	return strings.TrimSpace(content)
}

// SuggestSkillID 从标题或笔记 id 推导合法 skill id。
func SuggestSkillID(title, noteID string) string {
	ascii := strings.ToLower(strings.TrimSpace(title))
	ascii = skillIDSuggestRE.ReplaceAllString(ascii, "-")
	ascii = strings.Trim(ascii, "-")
	if len(ascii) > 48 {
		ascii = ascii[:48]
	}
	if ascii != "" && ascii[0] >= 'a' && ascii[0] <= 'z' {
		return ascii
	}
	short := regexp.MustCompile(`[^a-zA-Z0-9]`).ReplaceAllString(noteID, "")
	if len(short) > 8 {
		short = short[:8]
	}
	if short == "" {
		short = "note"
	}
	return "note-" + strings.ToLower(short)
}

// EnsureSkillGroup 确保工作流目录存在（只建盘，不经 ListGroups，避免 Ensure 递归）。
func (s *Service) EnsureSkillGroup() error {
	if s == nil {
		return errnoNotebook("笔记本未就绪")
	}
	if err := s.EnsureWorkspace(); err != nil {
		return err
	}
	return s.ensureSystemDirs()
}

func stampSkillFrontmatter(content, skillID string) string {
	bodySrc := StripSkillMark(content)
	fm, body, has := splitFrontmatterMap(bodySrc)
	if !has {
		fm = map[string]interface{}{}
		body = strings.TrimLeft(bodySrc, " \t\r\n")
	}
	fm["role"] = model.NoteRoleSkill
	fm["name"] = skillID
	fm["skillId"] = skillID
	return WithLinkedSkillID(joinFrontmatterMap(fm, body), skillID)
}

// MarkNoteAsSkill 就地标为 Skill（同目录写成 SKILL.md），不迁到任务区「工作流/」。
// 无归属目录时才落到任务产品默认根（等同 PublishSkillToTaskRoot）。
func (s *Service) MarkNoteAsSkill(noteID, skillID string) (*model.NoteDO, error) {
	noteID = strings.TrimSpace(noteID)
	skillID = strings.TrimSpace(skillID)
	if noteID == "" || skillID == "" {
		return nil, fmt.Errorf("noteId / skill id 不能为空")
	}
	n, err := s.GetNote(noteID)
	if err != nil {
		return nil, err
	}
	n.Role = model.NoteRoleSkill
	n.Language = "markdown"
	n.Content = stampSkillFrontmatter(n.Content, skillID)

	if isSkillPathID(n.ID) {
		return s.SaveNote(*n)
	}

	dir := NoteParentDir(n.ID)
	if dir == "" {
		dir = strings.Trim(filepath.ToSlash(strings.TrimSpace(n.GroupID)), "/")
	}
	if dir == "" || dir == "." {
		return s.PublishSkillToTaskRoot(noteID, skillID)
	}
	// 保留原 id，saveNoteFS 按 GroupID 就地写出 SKILL.md 并清理旧文件
	n.GroupID = dir
	return s.SaveNote(*n)
}

// PublishSkillToTaskRoot 显式把笔记迁到任务产品根 工作流/{skillID}/SKILL.md。
func (s *Service) PublishSkillToTaskRoot(noteID, skillID string) (*model.NoteDO, error) {
	noteID = strings.TrimSpace(noteID)
	skillID = strings.TrimSpace(skillID)
	if noteID == "" || skillID == "" {
		return nil, fmt.Errorf("noteId / skill id 不能为空")
	}
	if err := s.EnsureSkillGroup(); err != nil {
		return nil, err
	}
	n, err := s.GetNote(noteID)
	if err != nil {
		return nil, err
	}
	n.Role = model.NoteRoleSkill
	n.Language = "markdown"
	n.GroupID = SkillGroupName + "/" + skillID
	n.Content = stampSkillFrontmatter(n.Content, skillID)
	// 保留原 id，saveNoteFS 据此清理旧文件并迁到 SkillNoteID(name)
	return s.SaveNote(*n)
}

// ListSkillNotes 列出工作流入口笔记（role=skill 且非 log.md；优先 SKILL.md 路径）。
func (s *Service) ListSkillNotes(limit int) ([]model.NoteSummaryDO, error) {
	if limit <= 0 {
		limit = 80
	}
	all, err := s.ListNotes()
	if err != nil {
		return nil, err
	}
	out := make([]model.NoteSummaryDO, 0)
	for _, n := range all {
		if IsTaskLogNoteID(n.ID) {
			continue
		}
		if NormalizeNoteRole(n.Role) != model.NoteRoleSkill && !isSkillPathID(n.ID) {
			continue
		}
		out = append(out, n)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// FindNoteIDBySkillID 按路径 / 短名 / 关联标记 / frontmatter name 找 Skill 入口（寻址 SSOT）。
// 短名查找优先已有 项目/ → 记忆区/ → 运维/，最后才是任务区 工作流/（Skill 跟资源走）。
func (s *Service) FindNoteIDBySkillID(skillID string) string {
	skillID = strings.TrimSpace(strings.ReplaceAll(skillID, "\\", "/"))
	if skillID == "" {
		return ""
	}
	// 注意：GetNote(短名) 内部会先映射到 工作流/{短名}，故短名查找勿先 GetNote(裸短名)。
	var try []string
	if strings.Contains(skillID, "/") {
		try = []string{skillID, SkillNoteID(skillID)}
	} else {
		try = []string{
			SkillEntryIDInDir(ProjectGroupName + "/" + skillID),
			SkillEntryIDInDir(WorkbenchProjectDirRel(skillID)),
			SkillNoteID(skillID), // 任务区默认路径放最后
		}
	}
	for _, id := range try {
		if id == "" {
			continue
		}
		if n, err := s.GetNote(id); err == nil && n != nil && !IsTaskLogNoteID(n.ID) {
			if isSkillPathID(n.ID) || NormalizeNoteRole(n.Role) == model.NoteRoleSkill {
				return n.ID
			}
		}
	}
	list, err := s.ListNotes()
	if err != nil {
		return ""
	}
	var basenameHits []string
	var titleHit string
	for _, sum := range list {
		if IsTaskLogNoteID(sum.ID) {
			continue
		}
		if SkillNameFromNoteID(sum.ID) == skillID {
			return sum.ID
		}
		if isSkillPathID(sum.ID) && SkillBasename(sum.ID) == skillID {
			basenameHits = append(basenameHits, sum.ID)
		}
		n, err := s.GetNote(sum.ID)
		if err != nil || n == nil {
			continue
		}
		if ReadLinkedSkillID(n.Content) == skillID {
			return n.ID
		}
		fm, _, ok := splitFrontmatterMap(n.Content)
		if ok && fmString(fm, "name") == skillID && NormalizeNoteRole(n.Role) == model.NoteRoleSkill {
			return n.ID
		}
		if p, pok := ParseWorkflowNote(*n); pok && strings.TrimSpace(p.Name) == skillID {
			return n.ID
		}
		if titleHit == "" && isSkillPathID(sum.ID) &&
			strings.EqualFold(strings.TrimSpace(n.Title), skillID) {
			titleHit = sum.ID
		}
	}
	for _, prefix := range []string{
		ProjectGroupName + "/",
		MemoryGroupName + "/",
		OpsGroupName + "/",
		SkillGroupName + "/",
	} {
		for _, hit := range basenameHits {
			if strings.HasPrefix(hit, prefix) {
				return hit
			}
		}
	}
	if len(basenameHits) == 1 {
		return basenameHits[0]
	}
	if len(basenameHits) > 0 {
		return basenameHits[0]
	}
	return titleHit
}

// ListAgentSlashSkills 笔记本工作流，供对话 / 菜单。
// 对外 id 与 list_skills / get_skill 一致；description 含 intent，便于按「微信发送」这类说法检索。
func (s *Service) ListAgentSlashSkills(limit int) []model.AgentSkillDO {
	if s == nil {
		return nil
	}
	notes, err := s.ListSkillNotes(limit)
	if err != nil || len(notes) == 0 {
		return nil
	}
	out := make([]model.AgentSkillDO, 0, len(notes))
	seen := map[string]struct{}{}
	for _, sum := range notes {
		n, err := s.GetNote(sum.ID)
		if err != nil || n == nil {
			continue
		}
		id := SkillNameFromNoteID(n.ID)
		if id == "" {
			id = ReadLinkedSkillID(n.Content)
		}
		name := ""
		desc := ""
		if wf, ok := ParseWorkflowNote(*n); ok {
			if wf.Name != "" && !strings.Contains(id, "/") {
				id = wf.Name
			}
			if id == "" {
				id = strings.TrimSpace(wf.Name)
			}
			name = firstNonEmpty(strings.TrimSpace(wf.Name), strings.TrimSpace(wf.Title))
			desc = strings.TrimSpace(wf.Description)
			if intent := strings.TrimSpace(wf.Intent); intent != "" && !strings.Contains(desc, intent) {
				desc = strings.TrimSpace(desc + " " + intent)
			}
		}
		if id == "" {
			id = SuggestSkillID(n.Title, n.ID)
		}
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		if name == "" || name == "SKILL" {
			name = id
		}
		out = append(out, model.AgentSkillDO{
			ID:          id,
			Name:        name,
			Description: desc,
			Enabled:     true,
		})
	}
	return out
}
