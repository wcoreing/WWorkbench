package notebook

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	// ProjectDialogDirName 项目下 Cursor 对话镜像目录名。
	ProjectDialogDirName = "对话"
)

// SafeProjectDirName 把项目名收成可作目录名的片段。
func SafeProjectDirName(name string) string {
	name = sanitizeFileStem(strings.TrimSpace(name))
	if name == "" {
		name = "untitled"
	}
	return name
}

// WorkbenchProjectDirRel 返回 项目/{safeName}。
func WorkbenchProjectDirRel(projectName string) string {
	return ProjectGroupName + "/" + SafeProjectDirName(projectName)
}

// WorkbenchProjectDialogDirRel 返回 项目/{safeName}/对话。
func WorkbenchProjectDialogDirRel(projectName string) string {
	return WorkbenchProjectDirRel(projectName) + "/" + ProjectDialogDirName
}

// CursorTranscriptNoteID 对话镜像笔记相对路径 id。
func CursorTranscriptNoteID(projectName, transcriptID string) string {
	tid := sanitizeFileStem(strings.TrimSpace(transcriptID))
	if tid == "" {
		tid = shortID()
	}
	return WorkbenchProjectDialogDirRel(projectName) + "/" + tid + ".md"
}

func (s *Service) ensureProjectSeedFS() error {
	path := filepath.Join(s.workspaceRoot(), ProjectGroupName, "怎么用项目区.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	content := "# 项目工作区\n\n" +
		"本目录是**项目产品**的笔记本工作根：每个 Workbench 项目对应 `项目/{名}/`。\n\n" +
		"- `对话/`：Cursor agent transcripts 的可读镜像（跨机真源在仓库 `.wworkbench/cursor-transcripts/`）\n" +
		"- 换机后先 git pull，再 sync/list/get_project_cursor_transcripts 续上下文\n" +
		"- 不能用 requestId 恢复原聊天窗；靠读历史 transcript 再开新对话\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

// EnsureWorkbenchProjectDialogDir 确保 项目/{名}/对话/ 存在，返回相对路径。
func (s *Service) EnsureWorkbenchProjectDialogDir(projectName string) (string, error) {
	if s == nil {
		return "", errno.New(errno.CodeStoreFailed, "笔记本未就绪", "")
	}
	_ = s.EnsureFSNotebook()
	rel := WorkbenchProjectDialogDirRel(projectName)
	abs := filepath.Join(s.workspaceRoot(), filepath.FromSlash(rel))
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "创建项目对话目录失败", err)
	}
	return rel, nil
}

// UpsertCursorTranscriptNote 写入/更新对话镜像笔记（稳定 id=项目/名/对话/{transcriptId}.md）。
func (s *Service) UpsertCursorTranscriptNote(projectID, projectName, transcriptID, title, body string) (*model.NoteDO, error) {
	if s == nil {
		return nil, errno.New(errno.CodeStoreFailed, "笔记本未就绪", "")
	}
	if _, err := s.EnsureWorkbenchProjectDialogDir(projectName); err != nil {
		return nil, err
	}
	tid := strings.TrimSpace(transcriptID)
	noteID := CursorTranscriptNoteID(projectName, tid)
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Cursor 对话 " + tid
	}
	body = strings.TrimSpace(body)
	fm := fmt.Sprintf("---\nrole: note\nwwbProjectId: %s\nkind: cursor-transcript\ntranscriptId: %s\n---\n\n",
		strings.TrimSpace(projectID), tid)
	content := fm + "# " + title + "\n\n" + body + "\n"
	now := time.Now().Unix()
	n := model.NoteDO{
		ID:        noteID,
		GroupID:   WorkbenchProjectDialogDirRel(projectName),
		Title:     title,
		Content:   content,
		Language:  "markdown",
		Role:      model.NoteRoleNote,
		UpdatedAt: now,
		CreatedAt: now,
	}
	if existing, err := s.GetNote(noteID); err == nil && existing != nil {
		n.CreatedAt = existing.CreatedAt
		if n.CreatedAt == 0 {
			n.CreatedAt = now
		}
	}
	return s.SaveNote(n)
}
