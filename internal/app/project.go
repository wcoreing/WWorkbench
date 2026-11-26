package app

import (
	"log"
	"strings"

	"WWorkbench/internal/cursorrule"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"
	"WWorkbench/internal/workbenchtools"
)

// ensureCursorUserProjectStageRuleOnStart MCP 开启时幂等写入 Cursor 全局开场规则。
func (s *Service) ensureCursorUserProjectStageRuleOnStart() {
	if s == nil || s.store == nil || !s.store.MCPEnabled() {
		return
	}
	r, err := cursorrule.EnsureUserProjectStageRule()
	if err != nil {
		log.Printf("cursorrule: user project stage: %v", err)
		return
	}
	if r.Written {
		log.Printf("cursorrule: user project stage written %s", r.Path)
	}
}

// ensureProjectNotebookRoot 确保 项目/{名}/对话/ 落盘，供指挥台一跳打开。
func (s *Service) ensureProjectNotebookRoot(name string) {
	if s == nil || s.notebook == nil {
		return
	}
	_, _ = s.notebook.EnsureWorkbenchProjectDialogDir(name)
}

// ListWorkbenchProjects 列出项目组合。
func (s *Service) ListWorkbenchProjects() ApiResult[[]model.WorkbenchProjectDO] {
	list, err := s.store.ListWorkbenchProjects()
	if err != nil {
		return ErrResult[[]model.WorkbenchProjectDO](err)
	}
	if list == nil {
		list = []model.WorkbenchProjectDO{}
	}
	return OkResult(list)
}

// GetWorkbenchProject 按 id 取项目。
func (s *Service) GetWorkbenchProject(id string) ApiResult[model.WorkbenchProjectDO] {
	p, err := s.store.GetWorkbenchProject(id)
	if err != nil {
		return ErrResult[model.WorkbenchProjectDO](err)
	}
	return OkResult(p)
}

// SaveWorkbenchProject 保存项目组合（文件夹锚点 + 资源链接）。
func (s *Service) SaveWorkbenchProject(p model.WorkbenchProjectDO) ApiResult[model.WorkbenchProjectDO] {
	workbenchtools.EnsureProjectGitRemote(&p)
	op := workbench.RadarOpUpdate
	if strings.TrimSpace(p.ID) == "" {
		op = workbench.RadarOpCreate
	}
	saved, err := s.store.SaveWorkbenchProject(p)
	if err != nil {
		return ErrResult[model.WorkbenchProjectDO](err)
	}
	s.ensureProjectNotebookRoot(saved.Name)
	_ = s.store.SetAppSetting(store.SettingLastWorkbenchProjectID, saved.ID)
	if s.radar != nil {
		s.radar.EmitAsset(workbench.RadarDomainProject, "project", op, saved.ID, "ui-project-save", saved.Name, true)
	}
	if lp := strings.TrimSpace(saved.LocalPath); lp != "" {
		_, _ = cursorrule.EnsureStageRule(lp)
	}
	return OkResult(saved)
}

// DeleteWorkbenchProject 删除项目组合。
func (s *Service) DeleteWorkbenchProject(id string) ApiResult[bool] {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "id 不能为空", ""))
	}
	p, _ := s.store.GetWorkbenchProject(id)
	if err := s.store.DeleteWorkbenchProject(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitAsset(workbench.RadarDomainProject, "project", workbench.RadarOpDelete, id, "ui-project-delete", p.Name, false)
	}
	return OkResult(true)
}

func (s *Service) projectToolDeps() (*workbenchtools.Deps, error) {
	if s.toolsRegistry == nil {
		return nil, errno.New(errno.CodeStoreFailed, "工具注册表未就绪", "")
	}
	return s.toolsRegistry.Deps(), nil
}

// DetectWorkbenchProjectGitRemote 从本机目录探测 git origin URL。
func (s *Service) DetectWorkbenchProjectGitRemote(localPath string) ApiResult[string] {
	return OkResult(workbenchtools.DetectGitRemote(localPath))
}

// SuggestWorkbenchProjectResources 智能配置：按项目上下文建议可钉资源。
func (s *Service) SuggestWorkbenchProjectResources(p model.WorkbenchProjectDO) ApiResult[model.SuggestProjectResourcesResultDO] {
	if id := strings.TrimSpace(p.ID); id != "" {
		got, err := s.store.GetWorkbenchProject(id)
		if err != nil {
			return ErrResult[model.SuggestProjectResourcesResultDO](err)
		}
		p = got
	}
	if strings.TrimSpace(p.Name) == "" && strings.TrimSpace(p.LocalPath) == "" {
		return ErrResult[model.SuggestProjectResourcesResultDO](errno.New(errno.CodeInvalidArg, "请提供项目 id 或 name/localPath", ""))
	}
	deps, err := s.projectToolDeps()
	if err != nil {
		return ErrResult[model.SuggestProjectResourcesResultDO](err)
	}
	out := workbenchtools.SuggestProjectResources(deps, p)
	return OkResult(out)
}

// ConfigureWorkbenchProjectResources 智能配置：把候选 keys（kind:id）钉进项目并保存；keys 空=全采纳未钉建议。
func (s *Service) ConfigureWorkbenchProjectResources(id string, keys []string) ApiResult[model.ConfigureProjectResourcesResultDO] {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrResult[model.ConfigureProjectResourcesResultDO](errno.New(errno.CodeInvalidArg, "id 不能为空", ""))
	}
	deps, err := s.projectToolDeps()
	if err != nil {
		return ErrResult[model.ConfigureProjectResourcesResultDO](err)
	}
	out, err := workbenchtools.ConfigureProjectResources(deps, id, keys)
	if err != nil {
		return ErrResult[model.ConfigureProjectResourcesResultDO](err)
	}
	s.ensureProjectNotebookRoot(out.Project.Name)
	return OkResult(out)
}

// EnsureCursorStageRules 对所有带 localPath 的项目幂等写入 Cursor 舞台优先规则。
func (s *Service) EnsureCursorStageRules() ApiResult[model.EnsureCursorStageRulesResultDO] {
	deps, err := s.projectToolDeps()
	if err != nil {
		// Store 仍可用时直接扫项目
		if s.store == nil {
			return ErrResult[model.EnsureCursorStageRulesResultDO](err)
		}
		deps = &workbenchtools.Deps{Store: s.store}
	}
	out := workbenchtools.EnsureCursorStageRulesForStore(deps)
	return OkResult(out)
}

// OpenWorkbenchProjectStage 打开项目可控舞台（规则 + 对话同步 + SSH id）；UI 侧再开终端/钉 Agent。
func (s *Service) OpenWorkbenchProjectStage(id string) ApiResult[model.OpenWorkbenchProjectStageResultDO] {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrResult[model.OpenWorkbenchProjectStageResultDO](errno.New(errno.CodeInvalidArg, "id 不能为空", ""))
	}
	deps, err := s.projectToolDeps()
	if err != nil {
		return ErrResult[model.OpenWorkbenchProjectStageResultDO](err)
	}
	out, err := workbenchtools.OpenProjectStage(deps, workbenchtools.OpenProjectStageOpts{
		ID:     id,
		Source: "ui",
		Intent: "打开项目",
	})
	if err != nil {
		return ErrResult[model.OpenWorkbenchProjectStageResultDO](err)
	}
	s.ensureProjectNotebookRoot(out.Project.Name)
	return OkResult(out)
}

// EnsureCursorUserProjectStageRule 幂等写入 Cursor 全局用户规则（动手意图才 open_project_stage）。
func (s *Service) EnsureCursorUserProjectStageRule() ApiResult[model.CursorStageRuleDO] {
	r, err := cursorrule.EnsureUserProjectStageRule()
	out := model.CursorStageRuleDO{
		Path:    r.Path,
		Written: r.Written,
		Skipped: r.Skipped,
		Error:   r.Error,
	}
	if err != nil {
		return ErrResult[model.CursorStageRuleDO](err)
	}
	return OkResult(out)
}

// RemoveCursorUserProjectStageRule 移除托管的 Cursor 全局项目舞台用户规则。
func (s *Service) RemoveCursorUserProjectStageRule() ApiResult[model.CursorStageRuleDO] {
	r, err := cursorrule.RemoveUserProjectStageRule()
	out := model.CursorStageRuleDO{
		Path:    r.Path,
		Skipped: r.Skipped,
		Error:   r.Error,
	}
	if err != nil {
		return ErrResult[model.CursorStageRuleDO](err)
	}
	if r.Removed {
		out.Written = true
	}
	return OkResult(out)
}
