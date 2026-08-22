package app

import (
	"fmt"

	"WWorkbench/internal/skillstore"
	"WWorkbench/internal/model"
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

/** ListEnabledAgentSkills 列出已启用技能（供 / 菜单）。 */
func (s *Service) ListEnabledAgentSkills() ApiResult[[]model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[[]model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	list, err := skillstore.ListEnabledSkills(root)
	if err != nil {
		return ErrResult[[]model.AgentSkillDO](err)
	}
	if list == nil {
		list = []model.AgentSkillDO{}
	}
	return OkResult(list)
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

/** PublishAgentSkill 从笔记发布或更新技能。 */
func (s *Service) PublishAgentSkill(in model.AgentSkillPublishDO) ApiResult[model.AgentSkillDO] {
	root := s.harnessRoot()
	if root == "" {
		return ErrResult[model.AgentSkillDO](fmt.Errorf("ningharness 未就绪"))
	}
	sk, err := skillstore.UpsertSkill(root, in)
	if err != nil {
		return ErrResult[model.AgentSkillDO](err)
	}
	return OkResult(sk)
}

/** CreateAgentSkill 新建技能。 */
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

/** SaveAgentSkillFile 保存技能目录下文件。 */
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
