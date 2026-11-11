package app

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
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

// DeleteNotes 批量删除笔记。
func (s *Service) DeleteNotes(ids []string) ApiResult[int] {
	deleted, err := s.notebook.DeleteNotes(ids)
	if err != nil {
		return ErrResult[int](err)
	}
	if s.radar != nil {
		cleaned := make([]string, 0, len(ids))
		seen := make(map[string]struct{}, len(ids))
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			cleaned = append(cleaned, id)
		}
		if len(cleaned) > 0 {
			s.radar.Emit(workbench.RadarEvent{
				Domain:  workbench.RadarDomainNotebookNote,
				Op:      workbench.RadarOpDelete,
				IDs:     cleaned,
				WriteID: "ui-notebook-batch-delete",
				Product: "notebook",
			})
		}
	}
	return OkResult(deleted)
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

// SaveNotebookAsset 保存笔记附件（粘贴/拖放/文件选择，data 为 base64 或 data URL）。
func (s *Service) SaveNotebookAsset(in model.NotebookAssetUploadDO) ApiResult[model.NotebookAssetDO] {
	out, err := s.notebook.SaveAsset(in)
	if err != nil {
		return ErrResult[model.NotebookAssetDO](err)
	}
	return OkResult(*out)
}

// PickNotebookAssets 通过系统对话框选择并保存附件；imagesOnly 为 true 时仅图片。
func (s *Service) PickNotebookAssets(noteID string, imagesOnly bool) ApiResult[[]model.NotebookAssetDO] {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return ErrResult[[]model.NotebookAssetDO](errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", ""))
	}
	filters := []runtime.FileFilter{{DisplayName: "全部文件", Pattern: "*.*"}}
	title := "插入附件"
	if imagesOnly {
		title = "插入图片"
		filters = []runtime.FileFilter{
			{DisplayName: "图片", Pattern: "*.png;*.jpg;*.jpeg;*.webp;*.gif"},
			{DisplayName: "全部文件", Pattern: "*.*"},
		}
	}
	paths, err := runtime.OpenMultipleFilesDialog(s.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
	if err != nil {
		return ErrResult[[]model.NotebookAssetDO](err)
	}
	if len(paths) == 0 {
		return OkResult([]model.NotebookAssetDO{})
	}
	out := make([]model.NotebookAssetDO, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return ErrResult[[]model.NotebookAssetDO](errno.Wrap(errno.CodeStoreFailed, "读取文件失败", err))
		}
		asset, err := s.notebook.SaveAsset(model.NotebookAssetUploadDO{
			NoteID: noteID,
			Name:   filepath.Base(path),
			MIME:   "",
			Data:   base64.StdEncoding.EncodeToString(data),
		})
		if err != nil {
			return ErrResult[[]model.NotebookAssetDO](err)
		}
		if imagesOnly && !asset.IsImage {
			continue
		}
		out = append(out, *asset)
	}
	return OkResult(out)
}

// NotebookWorkspacePath 返回固定磁盘工作区绝对路径。
func (s *Service) NotebookWorkspacePath() ApiResult[string] {
	p := s.notebook.WorkspacePath()
	if p == "" {
		return ErrResult[string](errno.New(errno.CodeStoreFailed, "笔记本工作区未就绪", ""))
	}
	return OkResult(p)
}

// NoteDiskPath 返回笔记内容文件绝对路径。
func (s *Service) NoteDiskPath(noteID string) ApiResult[string] {
	p, err := s.notebook.NoteDiskPath(noteID)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(p)
}

// RevealNotebookNote 在访达/资源管理器中显示笔记文件（Skill 显示其目录）。
func (s *Service) RevealNotebookNote(noteID string) ApiResult[bool] {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return s.RevealNotebookWorkspace()
	}
	dir, err := s.notebook.NoteDirPath(noteID)
	if err != nil {
		// 非笔记路径：按工作区相对路径揭示
		return s.RevealNotebookPath(noteID)
	}
	file, ferr := s.notebook.NoteDiskPath(noteID)
	if ferr == nil {
		return revealInFileManager(file, true)
	}
	return revealInFileManager(dir, false)
}

// RevealNotebookPath 在访达中显示工作区内相对路径（文件选中 / 目录打开）。
func (s *Service) RevealNotebookPath(rel string) ApiResult[bool] {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return s.RevealNotebookWorkspace()
	}
	root := s.notebook.WorkspacePath()
	if root == "" {
		return ErrResult[bool](errno.New(errno.CodeStoreFailed, "笔记本工作区未就绪", ""))
	}
	abs := filepath.Join(root, filepath.FromSlash(rel))
	info, err := os.Stat(abs)
	if err != nil {
		return ErrResult[bool](errno.Wrap(errno.CodeNotFound, "路径不存在", err))
	}
	return revealInFileManager(abs, !info.IsDir())
}

// RenameNotebookPath 重命名工作区内文件/目录。
func (s *Service) RenameNotebookPath(rel, newName string) ApiResult[notebook.PathMutation] {
	out, err := s.notebook.RenameRel(rel, newName)
	if err != nil {
		return ErrResult[notebook.PathMutation](err)
	}
	return OkResult(out)
}

// MoveNotebookPath 移动到目标目录。
func (s *Service) MoveNotebookPath(fromRel, destDirRel string) ApiResult[notebook.PathMutation] {
	out, err := s.notebook.MoveRel(fromRel, destDirRel)
	if err != nil {
		return ErrResult[notebook.PathMutation](err)
	}
	return OkResult(out)
}

// CopyNotebookPath 复制到目标目录。
func (s *Service) CopyNotebookPath(fromRel, destDirRel string) ApiResult[notebook.PathMutation] {
	out, err := s.notebook.CopyRel(fromRel, destDirRel)
	if err != nil {
		return ErrResult[notebook.PathMutation](err)
	}
	return OkResult(out)
}

// DeleteNotebookPath 删除工作区内文件/目录。
func (s *Service) DeleteNotebookPath(rel string) ApiResult[bool] {
	if err := s.notebook.DeleteRel(rel); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// CreateNotebookDir 新建目录。
func (s *Service) CreateNotebookDir(parentRel, name string) ApiResult[string] {
	id, err := s.notebook.CreateDir(parentRel, name)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(id)
}

// CreateNotebookFile 在目录下新建空笔记文件。
func (s *Service) CreateNotebookFile(parentRel, name string) ApiResult[model.NoteDO] {
	n, err := s.notebook.CreateNoteFile(parentRel, name)
	if err != nil {
		return ErrResult[model.NoteDO](err)
	}
	return OkResult(*n)
}

// RevealNotebookWorkspace 在访达中打开笔记本工作区根目录。
func (s *Service) RevealNotebookWorkspace() ApiResult[bool] {
	p := s.notebook.WorkspacePath()
	if p == "" {
		return ErrResult[bool](errno.New(errno.CodeStoreFailed, "笔记本工作区未就绪", ""))
	}
	if err := os.MkdirAll(p, 0o700); err != nil {
		return ErrResult[bool](errno.Wrap(errno.CodeStoreFailed, "创建工作区失败", err))
	}
	return revealInFileManager(p, false)
}

func revealInFileManager(path string, selectFile bool) ApiResult[bool] {
	path = strings.TrimSpace(path)
	if path == "" {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "路径为空", ""))
	}
	if _, err := os.Stat(path); err != nil {
		return ErrResult[bool](errno.Wrap(errno.CodeInvalidArg, "路径不存在", err))
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		if selectFile {
			cmd = exec.Command("open", "-R", path)
		} else {
			cmd = exec.Command("open", path)
		}
	case "windows":
		if selectFile {
			cmd = exec.Command("explorer", "/select,", path)
		} else {
			cmd = exec.Command("explorer", path)
		}
	default:
		cmd = exec.Command("xdg-open", path)
		if selectFile {
			cmd = exec.Command("xdg-open", filepath.Dir(path))
		}
	}
	if err := cmd.Start(); err != nil {
		return ErrResult[bool](errno.Wrap(errno.CodeStoreFailed, "打开文件管理器失败", err))
	}
	return OkResult(true)
}
