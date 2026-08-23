package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/skillstore"
)

type updateAgentSkillArgs struct {
	ID            string `json:"id"`
	Content       string `json:"content"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	UpdateContent bool   `json:"updateContent"`
	UpdateGlobs   bool   `json:"updateGlobs"`
	Globs         []string `json:"globs"`
}

// toolUpdateAgentSkill 更新已有 Skill 正文或元数据（不写笔记）。
func toolUpdateAgentSkill(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	_ = ctx
	root := ""
	if d != nil && d.HarnessRoot != nil {
		root = strings.TrimSpace(d.HarnessRoot())
	}
	if root == "" {
		return Fail("ningharness 未就绪")
	}
	var in updateAgentSkillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("id 不能为空")
	}
	content := strings.TrimSpace(in.Content)
	name := strings.TrimSpace(in.Name)
	desc := strings.TrimSpace(in.Description)
	updateContent := in.UpdateContent
	updateGlobs := in.UpdateGlobs
	if content != "" && !updateContent {
		updateContent = true
	}
	if !updateContent && !updateGlobs && name == "" && desc == "" {
		return Fail("至少提供 content、name、description 或 updateGlobs")
	}
	sk, err := skillstore.SaveSkill(root, model.AgentSkillSaveDO{
		ID:            id,
		Content:       content,
		Name:          name,
		Description:   desc,
		Globs:         in.Globs,
		UpdateContent: updateContent,
		UpdateGlobs:   updateGlobs,
	})
	if err != nil {
		return Fail(err.Error())
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "id": sk.ID, "name": sk.Name, "description": sk.Description,
		"relPath": skillstore.SkillsRootRel + "/" + sk.ID + "/SKILL.md",
	})
	return OKData(string(b))
}
