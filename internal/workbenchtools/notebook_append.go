package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

type notebookAppendArgs struct {
	Title          string `json:"title"`
	Content        string `json:"content"`
	SSHHostID      string `json:"sshHostId"`
	ConnectionID   string `json:"connectionId"`
	AppendToNoteID string `json:"appendToNoteId"`
}

// toolNotebookAppend 创建或追加 Markdown 笔记。
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
		title = "AI 巡检 " + time.Now().Format("2006-01-02 15:04")
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
		n.UpdatedAt = time.Now().Unix()
		saved, err := d.Notebook.SaveNote(*n)
		if err != nil {
			return Fail(err.Error())
		}
		return OKData(map[string]interface{}{
			"noteId": saved.ID, "title": saved.Title, "appended": true,
		})
	}

	now := time.Now().Unix()
	n := model.NoteDO{
		ID: uuid.NewString(), Title: title, Content: content,
		Language: "markdown", SSHHostID: strings.TrimSpace(in.SSHHostID),
		ConnectionID: strings.TrimSpace(in.ConnectionID),
		CreatedAt: now, UpdatedAt: now,
	}
	saved, err := d.Notebook.SaveNote(n)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"noteId": saved.ID, "title": saved.Title, "created": true,
	})
}
