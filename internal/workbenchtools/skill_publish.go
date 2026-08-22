package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/skillstore"
)

type publishAgentSkillArgs struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	NoteID      string `json:"noteId"`
}

// toolPublishAgentSkill 发布或更新 Agent 技能（仅 / 手动调用）。
func toolPublishAgentSkill(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	_ = ctx
	root := ""
	if d != nil && d.HarnessRoot != nil {
		root = strings.TrimSpace(d.HarnessRoot())
	}
	if root == "" {
		return Fail("ningharness 未就绪")
	}
	var in publishAgentSkillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("id 不能为空")
	}
	content := notebook.StripSkillMark(strings.TrimSpace(in.Content))
	if content == "" {
		return Fail("content 不能为空")
	}
	sk, err := skillstore.UpsertSkill(root, model.AgentSkillPublishDO{
		ID:          id,
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(in.Description),
		Content:     content,
	})
	if err != nil {
		return Fail(err.Error())
	}
	noteID := strings.TrimSpace(in.NoteID)
	if noteID != "" && d != nil && d.Notebook != nil {
		if err := d.Notebook.LinkSkillNote(id, noteID); err != nil {
			return Fail("技能已发布，但笔记关联失败: " + err.Error())
		}
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "id": sk.ID, "name": sk.Name, "description": sk.Description,
		"relPath": skillstore.SkillsRootRel + "/" + sk.ID + "/SKILL.md",
	})
	return OKData(string(b))
}
