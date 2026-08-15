package app

import (
	"os"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListNotebookGroups 列出笔记本分组。
func (s *Service) ListNotebookGroups() ApiResult[[]model.NotebookGroupDO] {
	list, err := s.notebook.ListGroups()
	if err != nil {
		return ErrResult[[]model.NotebookGroupDO](err)
	}
	if list == nil {
		list = []model.NotebookGroupDO{}
	}
	return OkResult(list)
}

// SaveNotebookGroup 保存笔记本分组。
func (s *Service) SaveNotebookGroup(g model.NotebookGroupDO) ApiResult[model.NotebookGroupDO] {
	op := workbench.RadarOpUpdate
	if strings.TrimSpace(g.ID) == "" {
		op = workbench.RadarOpCreate
	}
	out, err := s.notebook.SaveGroup(g)
	if err != nil {
		return ErrResult[model.NotebookGroupDO](err)
	}
	if s.radar != nil {
		s.radar.EmitNotebookGroup(op, out.ID, "ui-notebook-group-save", out.Name, false)
	}
	return OkResult(*out)
}

// DeleteNotebookGroup 删除笔记本分组。
func (s *Service) DeleteNotebookGroup(id string) ApiResult[bool] {
	if err := s.notebook.DeleteGroup(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitNotebookGroup(workbench.RadarOpDelete, id, "ui-notebook-group-delete", "", false)
	}
	return OkResult(true)
}

// ListNotes 列出笔记摘要。
func (s *Service) ListNotes() ApiResult[[]model.NoteSummaryDO] {
	list, err := s.notebook.ListNotes()
	if err != nil {
		return ErrResult[[]model.NoteSummaryDO](err)
	}
	if list == nil {
		list = []model.NoteSummaryDO{}
	}
	return OkResult(list)
}

// SearchNotes 搜索笔记。
func (s *Service) SearchNotes(keyword string) ApiResult[[]model.NoteSummaryDO] {
	list, err := s.notebook.SearchNotes(keyword)
	if err != nil {
		return ErrResult[[]model.NoteSummaryDO](err)
	}
	if list == nil {
		list = []model.NoteSummaryDO{}
	}
	return OkResult(list)
}

// GetNote 获取笔记全文。
func (s *Service) GetNote(id string) ApiResult[model.NoteDO] {
	n, err := s.notebook.GetNote(id)
	if err != nil {
		return ErrResult[model.NoteDO](err)
	}
	return OkResult(*n)
}

// SaveNote 保存笔记。
func (s *Service) SaveNote(n model.NoteDO) ApiResult[model.NoteDO] {
	op := workbench.RadarOpUpdate
	if strings.TrimSpace(n.ID) == "" {
		op = workbench.RadarOpCreate
	}
	out, err := s.notebook.SaveNote(n)
	if err != nil {
		return ErrResult[model.NoteDO](err)
	}
	if s.radar != nil {
		s.radar.EmitNotebookNote(op, out.ID, "ui-notebook-save", out.Title, false)
	}
	return OkResult(*out)
}

// DeleteNote 删除笔记。
func (s *Service) DeleteNote(id string) ApiResult[bool] {
	if err := s.notebook.DeleteNote(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitNotebookNote(workbench.RadarOpDelete, id, "ui-notebook-delete", "", false)
	}
	return OkResult(true)
}

// DuplicateNote 复制笔记。
func (s *Service) DuplicateNote(id string) ApiResult[model.NoteDO] {
	n, err := s.notebook.DuplicateNote(id)
	if err != nil {
		return ErrResult[model.NoteDO](err)
	}
	return OkResult(*n)
}

// ExportNote 导出笔记到用户选择路径。
func (s *Service) ExportNote(id string) ApiResult[model.ExportResultDO] {
	n, err := s.notebook.GetNote(id)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	ext := ".txt"
	if n.Language == "markdown" {
		ext = ".md"
	} else if n.Language == "shell" {
		ext = ".sh"
	}
	safeName := strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(n.Title)
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出笔记",
		DefaultFilename: safeName + ext,
		Filters: []runtime.FileFilter{
			{DisplayName: "文本文件", Pattern: "*.*"},
		},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	body := n.Content
	if n.Language == "markdown" && !strings.HasPrefix(body, "# ") {
		body = "# " + n.Title + "\n\n" + body
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

// GetNotebookUI 获取笔记本 UI 状态。
func (s *Service) GetNotebookUI() ApiResult[model.NotebookUIDO] {
	ui, err := s.notebook.GetUI()
	if err != nil {
		return ErrResult[model.NotebookUIDO](err)
	}
	return OkResult(ui)
}

// ApplyNotebookLayout 保存笔记本侧栏布局（拖拽排序/跨组移动）。
func (s *Service) ApplyNotebookLayout(layout model.NotebookLayoutDO) ApiResult[bool] {
	if err := s.notebook.ApplyLayout(layout); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// SaveNotebookUI 保存笔记本 UI 状态。
func (s *Service) SaveNotebookUI(ui model.NotebookUIDO) ApiResult[bool] {
	if err := s.notebook.SaveUI(ui); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
