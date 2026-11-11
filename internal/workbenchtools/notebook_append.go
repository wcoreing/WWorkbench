package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

type notebookAppendArgs struct {
	Title          string `json:"title"`
	Content        string `json:"content"`
	Language       string `json:"language"`
	Role           string `json:"role"`
	SSHHostID      string `json:"sshHostId"`
	ConnectionID   string `json:"connectionId"`
	AppendToNoteID string `json:"appendToNoteId"`
	Reveal         *bool  `json:"reveal"`
}

// toolNotebookAppend 创建或追加运维文件/笔记（Cursor 管服务器的知识落盘）。
func toolNotebookAppend(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Notebook == nil {
		return Fail("笔记本服务未就绪")
	}
	var in notebookAppendArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	content := strings.TrimSpace(in.Content)
	if content == "" {
		return Fail("content 不能为空")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "运维记录 " + time.Now().Format("2006-01-02 15:04")
	}
	lang := strings.TrimSpace(in.Language)
	if lang == "" {
		lang = "markdown"
	}
	role := notebook.NormalizeNoteRole(strings.TrimSpace(in.Role))
	if role == "" {
		role = model.NoteRoleNote
	}
	reveal := true
	if in.Reveal != nil {
		reveal = *in.Reveal
	}

	if id := strings.TrimSpace(in.AppendToNoteID); id != "" {
		n, err := d.Notebook.GetNote(id)
		if err != nil {
			return Fail(err.Error())
		}
		if n.Content != "" {
			n.Content += "\n\n---\n\n"
		}
		n.Content += content
		if host := strings.TrimSpace(in.SSHHostID); host != "" {
			n.SSHHostID = host
		}
		if conn := strings.TrimSpace(in.ConnectionID); conn != "" {
			n.ConnectionID = conn
		}
		n.UpdatedAt = time.Now().Unix()
		saved, err := d.Notebook.SaveNote(*n)
		if err != nil {
			return Fail(err.Error())
		}
		if d.Radar != nil {
			d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, saved.ID, "agent-notebook-append", saved.Title, reveal)
		}
		revealNotebook(d, saved.ID, reveal)
		return OKData(map[string]interface{}{
			"noteId": saved.ID, "title": saved.Title, "language": saved.Language,
			"role": saved.Role, "sshHostId": saved.SSHHostID, "appended": true,
		})
	}

	now := time.Now().Unix()
	n := model.NoteDO{
		ID: uuid.NewString(), Title: title, Content: content,
		Language: lang, Role: role,
		SSHHostID: strings.TrimSpace(in.SSHHostID),
		ConnectionID: strings.TrimSpace(in.ConnectionID),
		CreatedAt: now, UpdatedAt: now,
	}
	saved, err := d.Notebook.SaveNote(n)
	if err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil {
		d.Radar.EmitNotebookNote(workbench.RadarOpCreate, saved.ID, "agent-notebook-create", saved.Title, reveal)
	}
	revealNotebook(d, saved.ID, reveal)
	return OKData(map[string]interface{}{
		"noteId": saved.ID, "title": saved.Title, "language": saved.Language,
		"role": saved.Role, "sshHostId": saved.SSHHostID, "created": true,
	})
}

func revealNotebook(d *Deps, noteID string, reveal bool) {
	if !reveal || d == nil || d.UIActions == nil || strings.TrimSpace(noteID) == "" {
		return
	}
	d.UIActions.Dispatch(UIActionNotebookOpen, map[string]interface{}{
		"noteId": noteID,
	})
}
