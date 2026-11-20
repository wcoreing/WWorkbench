package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/cursorrule"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

// attachCursorStageRule 若项目有 localPath则写入舞台优先 Cursor Rule。
func attachCursorStageRule(localPath string) *model.CursorStageRuleDO {
	lp := strings.TrimSpace(localPath)
	if lp == "" {
		return nil
	}
	r, err := cursorrule.EnsureStageRule(lp)
	out := &model.CursorStageRuleDO{
		Path:    r.Path,
		Written: r.Written,
		Skipped: r.Skipped,
	}
	if err != nil {
		out.Error = err.Error()
	}
	return out
}

// EnsureCursorStageRulesForStore 对所有带 localPath 的项目幂等写入舞台规则。
func EnsureCursorStageRulesForStore(d *Deps) model.EnsureCursorStageRulesResultDO {
	out := model.EnsureCursorStageRulesResultDO{}
	if d == nil || d.Store == nil {
		return out
	}
	list, err := d.Store.ListWorkbenchProjects()
	if err != nil || len(list) == 0 {
		return out
	}
	for _, p := range list {
		item := model.CursorStageRuleProjectDO{
			ProjectID:   p.ID,
			ProjectName: p.Name,
			LocalPath:   p.LocalPath,
		}
		if strings.TrimSpace(p.LocalPath) == "" {
			item.Error = "无 localPath"
			out.NErr++
			out.Results = append(out.Results, item)
			continue
		}
		r, err := cursorrule.EnsureStageRule(p.LocalPath)
		item.Path = r.Path
		item.Written = r.Written
		item.Skipped = r.Skipped
		if err != nil {
			item.Error = err.Error()
			out.NErr++
		} else if r.Skipped {
			out.NSkip++
		} else {
			out.NOK++
		}
		out.Results = append(out.Results, item)
	}
	return out
}

func toolEnsureCursorStageRule(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ProjectID string `json:"projectId"`
		ID        string `json:"id"`
		LocalPath string `json:"localPath"`
		Intent    string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	lp := strings.TrimSpace(in.LocalPath)
	pid := strings.TrimSpace(in.ProjectID)
	if pid == "" {
		pid = strings.TrimSpace(in.ID)
	}
	var project *model.WorkbenchProjectDO
	if pid != "" {
		if d == nil || d.Store == nil {
			return Fail("Store 未就绪")
		}
		p, err := d.Store.GetWorkbenchProject(pid)
		if err != nil {
			return Fail(err.Error())
		}
		project = &p
		if lp == "" {
			lp = p.LocalPath
		}
	}
	if lp == "" {
		return Fail("请提供 projectId 或 localPath")
	}
	r, err := cursorrule.EnsureStageRule(lp)
	if err != nil {
		return Fail(err.Error())
	}
	data := map[string]interface{}{
		"ok":      true,
		"path":    r.Path,
		"written": r.Written,
		"skipped": r.Skipped,
		"cursorStageRule": model.CursorStageRuleDO{
			Path: r.Path, Written: r.Written, Skipped: r.Skipped,
		},
		"note": "已写入 .cursor/rules/wworkbench-stage.mdc（alwaysApply）。新开 Cursor 对话后生效。",
	}
	if project != nil {
		data["projectId"] = project.ID
		data["projectName"] = project.Name
		data["localPath"] = project.LocalPath
	} else {
		data["localPath"] = lp
	}
	_ = in.Intent
	return OKData(data)
}

func registerCursorStageRuleTool(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapEnsureCursorStageRule,
		Description: "向项目写入 Cursor alwaysApply 舞台优先规则（.cursor/rules/wworkbench-stage.mdc），" +
			"迫使外置 Agent 优先走 WWorkbench MCP 而非自带 Shell。传 projectId 或 localPath；须 intent。幂等。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"projectId": map[string]interface{}{"type": "string", "description": "项目 id（与 id 同义）"},
				"id":        map[string]interface{}{"type": "string", "description": "项目 id"},
				"localPath": map[string]interface{}{"type": "string", "description": "本机项目文件夹；无 projectId 时必填"},
				"intent":    intentProp(),
			},
			"required": []string{"intent"},
		},
		Handler: toolEnsureCursorStageRule,
	})
}
