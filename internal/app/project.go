package app

import (
	"strings"

	"WWorkbench/internal/cursorrule"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"
	"WWorkbench/internal/workbenchtools"
)

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
