package app

import (
	"fmt"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/skillstore"
)

func (s *Service) harnessRoot() string {
	if s == nil || s.harnessHost == nil {
		return ""
	}
	return s.harnessHost.Root
}

/** ListAgentSkills 列出全部技能（含禁用）。 */
func (s *Service) ListAgentSkills() ApiResult[[]model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[[]model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	list, err := skillstore.ListSkills(root)
	if err != nil {
		return ErrResult[[]model.AgentSkillDO](err)
	}
	if list == nil {
		list = []model.AgentSkillDO{}
	}
	return OkResult(list)
}

/** ListEnabledAgentSkills 列出已启用技能（供 / 菜单）。笔记本工作流在前，ningharness system/skills 在后。 */
func (s *Service) ListEnabledAgentSkills() ApiResult[[]model.AgentSkillDO] {
	var list []model.AgentSkillDO
	var herr error
	if root := s.harnessRoot(); root != "" {
		list, herr = skillstore.ListEnabledSkills(root)
	} else {
		herr = fmt.Errorf("ningharness 未就绪")
	}
	var notes []model.AgentSkillDO
	if s != nil && s.notebook != nil {
		notes = s.notebook.ListAgentSlashSkills(80)
	}
	merged := mergeSlashSkills(notes, list)
	if len(merged) == 0 && herr != nil {
		return ErrResult[[]model.AgentSkillDO](herr)
	}
	if merged == nil {
		merged = []model.AgentSkillDO{}
	}
	return OkResult(merged)
}

// mergeSlashSkills 笔记本技能优先；同 id 不重复。
func mergeSlashSkills(notes, harness []model.AgentSkillDO) []model.AgentSkillDO {
	if len(notes) == 0 {
		return harness
	}
	seen := map[string]struct{}{}
	out := make([]model.AgentSkillDO, 0, len(notes)+len(harness))
	for _, n := range notes {
		id := strings.TrimSpace(n.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		n.ID = id
		out = append(out, n)
	}
	for _, h := range harness {
		id := strings.TrimSpace(h.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, h)
	}
	return out
}

/** GetAgentSkill 读取技能正文。 */
func (s *Service) GetAgentSkill(id string) ApiResult[model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	sk, err := skillstore.GetSkill(root, id)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(sk)
}

/** SetAgentSkillEnabled 启用/禁用技能。 */
func (s *Service) SetAgentSkillEnabled(in model.AgentSkillEnabledDO) ApiResult[model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	sk, err := skillstore.SetSkillEnabled(root, in.ID, in.Enabled)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(sk)
}

/** SaveAgentSkill 保存技能正文与元数据。 */
func (s *Service) SaveAgentSkill(in model.AgentSkillSaveDO) ApiResult[model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	if !in.UpdateContent && !in.UpdateGlobs && in.Name == "" && in.Description == "" {
		in.UpdateContent = true
	}
	sk, err := skillstore.SaveSkill(root, in)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(sk)
}

/** PublishAgentSkill 将笔记标为工作流（笔记本真源）。 */
func (s *Service) PublishAgentSkill(in model.AgentSkillPublishDO) ApiResult[model.AgentSkillDO] {
	return s.PublishNoteAsSkill(in)
}

/** PublishNoteAsSkill 笔记标 role=skill；不写 system/skills。 */
func (s *Service) PublishNoteAsSkill(in model.AgentSkillPublishDO) ApiResult[model.AgentSkillDO] {
	if s.notebook == nil {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("笔记本未就绪"))
	}
	noteID := strings.TrimSpace(in.NoteID)
	if noteID == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("请提供 noteId"))
	}
	n, err := s.notebook.GetNote(noteID)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	id := strings.TrimSpace(in.ID)
	name := strings.TrimSpace(in.Name)
	desc := strings.TrimSpace(in.Description)
	content := strings.TrimSpace(in.Content)
	if id == "" {
		id = notebook.ReadLinkedSkillID(n.Content)
	}
	if id == "" {
		if p, ok := notebook.ParseWorkflowNote(*n); ok && strings.TrimSpace(p.Name) != "" {
			id = strings.TrimSpace(p.Name)
		}
	}
	if id == "" {
		id = notebook.SkillNameFromNoteID(n.ID)
	}
	if id == "" {
		id = notebook.SuggestSkillID(n.Title, n.ID)
	}
	if content == "" {
		content = notebook.SkillBodyFromNote(n.Content)
	}
	if name == "" {
		name = strings.TrimSpace(n.Title)
	}
	if desc == "" {
		fm, _, ok := notebook.PeekFrontmatter(n.Content)
		if ok {
			desc = notebook.FrontmatterString(fm, "description")
		}
	}
	if id == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("skill id 不能为空"))
	}
	body := notebook.SkillBodyFromNote(content)
	if body == "" {
		body = content
	}
	if body == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("技能正文不能为空"))
	}
	if _, err := s.notebook.MarkNoteAsSkill(noteID, id); err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(model.AgentSkillDO{
		ID: id, Name: firstNonEmptyStr(name, id), Description: desc,
		Content: body, Enabled: true,
	})
}

/** CreateAgentSkill 在导出缓存新建 Skill（偏好：笔记本方法笔记 + PublishNoteAsSkill）。 */
func (s *Service) CreateAgentSkill(in model.AgentSkillCreateDO) ApiResult[model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	sk, err := skillstore.CreateSkill(root, in.ID, in.Name, in.Description, in.Content)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(sk)
}

/** DeleteAgentSkill 删除非受保护技能。 */
func (s *Service) DeleteAgentSkill(id string) ApiResult[bool] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[bool](fmt.Errorf("ningharness 未就绪"))
	}
	if err := skillstore.DeleteSkill(root, id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

/** ListSkillsDir 列出 system/skills 下某层目录的直接子项。 */
func (s *Service) ListSkillsDir(subPath string) ApiResult[[]model.FileEntryDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[[]model.FileEntryDO](fmt.Errorf("ningharness 未就绪"))
	}
	list, err := skillstore.ListSkillsDir(root, subPath)
	if err != nil {
		return ErrResult[[]model.FileEntryDO](err)
	}
	if list == nil {
		list = []model.FileEntryDO{}
	}
	return OkResult(list)
}

/** GetAgentSkillFile 读取技能目录下文件正文。 */
func (s *Service) GetAgentSkillFile(path string) ApiResult[string] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[string](fmt.Errorf("ningharness 未就绪"))
	}
	body, err := skillstore.ReadSkillFile(root, path)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(body)
}

/** SaveAgentSkillFile 写导出缓存文件（非笔记真源）。 */
func (s *Service) SaveAgentSkillFile(in model.AgentSkillFileSaveDO) ApiResult[bool] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[bool](fmt.Errorf("ningharness 未就绪"))
	}
	if err := skillstore.WriteSkillFile(root, in.Path, in.Content); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
