package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
)

const (
	maxListNotes   = 80
	maxSearchNotes = 40
)

type searchNotesArgs struct {
	Query string `json:"query"`
}

type getNoteArgs struct {
	NoteID string `json:"noteId"`
}

// toolListNotes 列出笔记摘要（无正文）。
func toolListNotes(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d.Notebook == nil {
		return Fail("笔记本服务未就绪")
	}
	list, err := d.Notebook.ListNotes()
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(noteSummaryPayload(d, list, maxListNotes))
}

// toolSearchNotes 按标题/正文搜索笔记摘要。
func toolSearchNotes(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Notebook == nil {
		return Fail("笔记本服务未就绪")
	}
	var in searchNotesArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	q := strings.TrimSpace(in.Query)
	if q == "" {
		return Fail("请填写 query（标题或正文关键词）")
	}
	list, err := d.Notebook.SearchNotes(q)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(noteSummaryPayload(d, list, maxSearchNotes))
}

// toolGetNote 读取笔记 Markdown 全文。
func toolGetNote(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Notebook == nil {
		return Fail("笔记本服务未就绪")
	}
	var in getNoteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	id := strings.TrimSpace(in.NoteID)
	if id == "" {
		return Fail("请填写 noteId。当前打开的笔记在本轮工作台现状里；也可 search_notes / list_notes 查找。笔记在工作台库内，不要 cat 文件，也不要用 recall_resource。")
	}
	n, err := d.Notebook.GetNote(id)
	if err != nil {
		return Fail(err.Error())
	}
	groups := noteGroupNames(d)
	group := "根目录"
	if n.GroupID != "" {
		if name, ok := groups[n.GroupID]; ok && name != "" {
			group = name
		}
	}
	return OKData(map[string]interface{}{
		"noteId":       n.ID,
		"title":        n.Title,
		"groupId":      n.GroupID,
		"group":        group,
		"language":     n.Language,
		"sshHostId":    n.SSHHostID,
		"connectionId": n.ConnectionID,
		"content":      n.Content,
		"updatedAt":    n.UpdatedAt,
	})
}

func noteGroupNames(d *Deps) map[string]string {
	out := map[string]string{}
	if d == nil || d.Notebook == nil {
		return out
	}
	groups, err := d.Notebook.ListGroups()
	if err != nil {
		return out
	}
	for _, g := range groups {
		out[g.ID] = g.Name
	}
	return out
}

func noteSummaryPayload(d *Deps, list []model.NoteSummaryDO, limit int) map[string]interface{} {
	if list == nil {
		list = []model.NoteSummaryDO{}
	}
	groups := noteGroupNames(d)
	total := len(list)
	clipped := list
	if limit > 0 && total > limit {
		clipped = list[:limit]
	}
	items := make([]map[string]interface{}, 0, len(clipped))
	for _, n := range clipped {
		group := "根目录"
		if n.GroupID != "" {
			if name, ok := groups[n.GroupID]; ok && name != "" {
				group = name
			}
		}
		items = append(items, map[string]interface{}{
			"noteId":    n.ID,
			"title":     n.Title,
			"groupId":   n.GroupID,
			"group":     group,
			"language":  n.Language,
			"updatedAt": n.UpdatedAt,
		})
	}
	return map[string]interface{}{
		"notes":     items,
		"total":     total,
		"truncated": total > len(items),
	}
}
