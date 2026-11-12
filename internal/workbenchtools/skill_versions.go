package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

// Skill 版本工具：薄封装到目录版本（dir=工作流/{name}）。

func toolPinSkillVersion(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Skill   string `json:"skill"`
		Name    string `json:"name"`
		Message string `json:"message"`
		Intent  string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	key := strings.TrimSpace(in.Skill)
	if key == "" {
		key = strings.TrimSpace(in.Name)
	}
	if key == "" {
		return Fail("请提供 skill（或 name）")
	}
	rel, err := notebook.SkillDirRel(key)
	if err != nil {
		return Fail(err.Error())
	}
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		msg = strings.TrimSpace(in.Intent)
	}
	if msg == "" {
		msg = "pin_skill_version"
	} else if !strings.HasPrefix(msg, "pin:") && !strings.HasPrefix(msg, "update_skill") {
		msg = "pin: " + msg
	}
	raw2, _ := json.Marshal(map[string]any{"dir": rel, "message": msg})
	return toolPinDirVersion(nil, d, raw2)
}

func toolListSkillVersions(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Skill string `json:"skill"`
		Name  string `json:"name"`
		Limit int    `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	key := strings.TrimSpace(in.Skill)
	if key == "" {
		key = strings.TrimSpace(in.Name)
	}
	if key == "" {
		return Fail("请提供 skill（或 name）")
	}
	rel, err := notebook.SkillDirRel(key)
	if err != nil {
		return Fail(err.Error())
	}
	raw2, _ := json.Marshal(map[string]any{"dir": rel, "limit": in.Limit})
	res := toolListDirVersions(nil, d, raw2)
	if !res.OK {
		return res
	}
	return res
}

func toolRestoreSkillVersion(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Skill  string `json:"skill"`
		Name   string `json:"name"`
		Hash   string `json:"hash"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	key := strings.TrimSpace(in.Skill)
	if key == "" {
		key = strings.TrimSpace(in.Name)
	}
	hash := strings.TrimSpace(in.Hash)
	intent := strings.TrimSpace(in.Intent)
	if key == "" || hash == "" || intent == "" {
		return Fail("请提供 skill、hash 与 intent")
	}
	rel, err := notebook.SkillDirRel(key)
	if err != nil {
		return Fail(err.Error())
	}
	_ = d
	return Confirm(uuid.NewString(), "回退 Skill 版本 · "+key, map[string]interface{}{
		"skill": key, "dir": rel, "hash": hash, "intent": intent, "action": "restore_skill_version",
	})
}

// RestoreSkillVersionConfirmed 确认后回退技能目录。
func RestoreSkillVersionConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in struct {
		Skill  string `json:"skill"`
		Name   string `json:"name"`
		Dir    string `json:"dir"`
		Hash   string `json:"hash"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal([]byte(argsJSON), &in)
	key := strings.TrimSpace(in.Skill)
	if key == "" {
		key = strings.TrimSpace(in.Name)
	}
	dir := strings.TrimSpace(in.Dir)
	if dir == "" && key != "" {
		dir, _ = notebook.SkillDirRel(key)
	}
	hash := strings.TrimSpace(in.Hash)
	if dir == "" || hash == "" {
		return Fail("skill/dir / hash 不能为空")
	}
	raw, _ := json.Marshal(map[string]any{"dir": dir, "hash": hash, "intent": in.Intent})
	res := RestoreDirVersionConfirmed(ctx, d, string(raw))
	if res.OK && key != "" && d != nil && d.Radar != nil {
		noteID := notebook.SkillNoteID(key)
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, noteID, "workflow-"+key, key, true)
	}
	return res
}
