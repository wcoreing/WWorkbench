package notebook

import (
	"fmt"

	"WWorkbench/internal/model"
)

// ResolveWorkflow 按 name / noteId 读取工作流笔记。
func (s *Service) ResolveWorkflow(idOrName string) (model.WorkflowDO, error) {
	if s == nil {
		return model.WorkflowDO{}, fmt.Errorf("工作流不存在: %s", idOrName)
	}
	p, err := s.GetWorkflowNote(idOrName)
	if err != nil || p.Name == "" {
		return model.WorkflowDO{}, fmt.Errorf("工作流不存在: %s", idOrName)
	}
	return p, nil
}

// ListWorkflowsSSOT 列出工作流笔记（EnsureFSNotebook 已种内置样板）。
func (s *Service) ListWorkflowsSSOT(limit int) []model.WorkflowDO {
	if limit <= 0 {
		limit = 50
	}
	notes, err := s.ListWorkflowNotes(limit)
	if err != nil || notes == nil {
		return []model.WorkflowDO{}
	}
	return notes
}
