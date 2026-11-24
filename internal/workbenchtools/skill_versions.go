package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

// Skill 版本工具：经 skill.Store（目录版本）。

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
	if d == nil || d.Skills == nil {
		return Fail("技能存储未就绪")
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
	v, err := d.Skills.Pin(key, msg)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]any{"ok": true, "skill": key, "version": v})
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
	if d == nil || d.Skills == nil {
		return Fail("技能存储未就绪")
	}
	st, err := d.Skills.ListVersions(key, in.Limit)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]any{
		"ok": true, "skill": key, "dir": st.Dir, "head": st.Head,
		"enabled": st.Enabled, "working": st.Working, "versions": st.Commits,
	})
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

// RestoreSkillVersionConfirmed 确认后回退技能目录（经 skill.Store）。
func RestoreSkillVersionConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	_ = ctx
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
	if key == "" {
		key = strings.TrimSpace(in.Dir)
	}
	hash := strings.TrimSpace(in.Hash)
	if key == "" || hash == "" {
		return Fail("skill/dir / hash 不能为空")
	}
	if d == nil || d.Skills == nil {
		return Fail("技能存储未就绪")
	}
	msg := strings.TrimSpace(in.Intent)
	if msg == "" {
		msg = "restore_skill_version"
	}
	v, err := d.Skills.Restore(key, hash, msg)
	if err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil {
		noteID := notebook.SkillNoteID(key)
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, noteID, "workflow-"+key, key, true)
	}
	return OKData(map[string]any{"ok": true, "skill": key, "version": v})
}
