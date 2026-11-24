package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
)

// toolListSkills 列出已安装方法包（经 skill.Store；含任意业务根下的 SKILL.md）。
func toolListSkills(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	_ = raw
	type item struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description,omitempty"`
		NoteID      string `json:"noteId,omitempty"`
		DiskPath    string `json:"diskPath,omitempty"`
		SkillDir    string `json:"skillDir,omitempty"`
		AssetsDir   string `json:"assetsDir,omitempty"`
		Source      string `json:"source"`
		HasSteps    bool   `json:"hasSteps,omitempty"`
	}
	if d == nil || d.Skills == nil {
		return Fail("技能存储未就绪")
	}

	list, err := d.Skills.List("")
	if err != nil {
		return Fail(err.Error())
	}
	seen := map[string]struct{}{}
	out := make([]item, 0, len(list)+1)
	for _, pkg := range list {
		id := strings.TrimSpace(pkg.ID)
		if id == "" {
			id = strings.TrimSpace(pkg.Dir)
		}
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, item{
			ID: id, Name: firstNonEmpty(pkg.Name, id),
			Description: pkg.Description, NoteID: pkg.NoteID,
			DiskPath: firstNonEmpty(pkg.DiskPath, pkg.Dir), SkillDir: pkg.Dir, AssetsDir: pkg.AssetsDir,
			Source: "skill", HasSteps: pkg.HasSteps,
		})
	}
	if _, ok := seen["cms_new_article"]; !ok {
		out = append(out, item{
			ID: "cms_new_article", Name: "后台新增方案",
			Description: "内置：find(新增)→click→wait(保存)", Source: "builtin", HasSteps: true,
		})
	}

	b, _ := json.Marshal(map[string]any{"ok": true, "skills": out, "total": len(out), "ssot": "skill"})
	return OKData(string(b))
}

// toolGetSkill 读取方法包正文（经 skill.Store）。
func toolGetSkill(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Skill string `json:"skill"`
		ID    string `json:"id"`
		Name  string `json:"name"`
	}
	_ = json.Unmarshal(raw, &in)
	key := strings.TrimSpace(in.Skill)
	if key == "" {
		key = strings.TrimSpace(in.ID)
	}
	if key == "" {
		key = strings.TrimSpace(in.Name)
	}
	if key == "" {
		return Fail("请提供 skill（id 或 name）")
	}
	if key == "cms_new_article" {
		return OKData(map[string]interface{}{
			"ok": true, "id": "cms_new_article", "name": "后台新增方案",
			"source": "builtin", "hasSteps": true,
			"content": "内置 Skill：find(新增) → click → wait(保存) → optional fill(title) → snapshot。用 run_skill(name=cms_new_article) 或自行 browser_*。",
			"run":     map[string]any{"tool": "run_skill", "name": "cms_new_article"},
		})
	}
	if d == nil || d.Skills == nil {
		return Fail("技能存储未就绪")
	}

	pkg, err := d.Skills.Get(key)
	if err != nil {
		return Fail("未找到工作流：" + key + "（任意业务根下的 SKILL.md，含 工作流/ 与 记忆区/…/项目/）")
	}
	runName := firstNonEmpty(pkg.ID, key)
	if pkg.AssetsDir != "" {
		SetCallerSkillAssets(ctx, pkg.AssetsDir)
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "id": runName, "name": firstNonEmpty(pkg.Name, runName),
		"noteId": pkg.NoteID, "source": "skill", "hasSteps": pkg.HasSteps,
		"diskPath": pkg.DiskPath, "skillDir": pkg.Dir, "assetsDir": pkg.AssetsDir,
		"content": pkg.Content,
		"run":     map[string]any{"tool": "run_skill", "name": runName, "note": "可选机械捷径；优先读正文后由 Agent 用工具执行"},
	})
	return OKData(string(b))
}
