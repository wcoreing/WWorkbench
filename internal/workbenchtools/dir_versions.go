package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

func toolEnableDirVersion(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Dir    string `json:"dir"`
		Path   string `json:"path"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	if dir == "" {
		return Fail("请提供 dir（笔记本相对目录，如 工作流/demo 或 记忆/主机A）")
	}
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	st, err := d.Notebook.EnableDirVersion(dir)
	if err != nil {
		return Fail(err.Error())
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "rel": st.Rel, "enabled": st.Enabled, "head": st.Head,
		"versions": st.Commits, "total": len(st.Commits),
		"note": "目录已启用版本；此后 pin_dir_version / update_skill 会创建版本。",
	})
	return OKData(string(b))
}

func toolListDirVersions(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Dir   string `json:"dir"`
		Path  string `json:"path"`
		Limit int    `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	if dir == "" {
		return Fail("请提供 dir")
	}
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	st, err := d.Notebook.ListDirVersions(dir, in.Limit)
	if err != nil {
		return Fail(err.Error())
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "rel": st.Rel, "enabled": st.Enabled,
		"head": st.Head, "working": st.Working, "versions": st.Commits, "total": len(st.Commits),
		"note": "笔记本目录版本；工作流目录默认排除 log.md。未启用时先 enable_dir_version。",
	})
	return OKData(string(b))
}

func toolPinDirVersion(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Dir     string `json:"dir"`
		Path    string `json:"path"`
		Message string `json:"message"`
		Intent  string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	if dir == "" {
		return Fail("请提供 dir")
	}
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		msg = strings.TrimSpace(in.Intent)
	}
	if msg == "" {
		msg = "pin_dir_version"
	}
	ci, err := d.Notebook.PinDirVersion(dir, msg)
	if err != nil {
		return Fail(err.Error())
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "rel": dir, "version": ci,
		"note": "已创建版本；list_dir_versions 可查看。",
	})
	return OKData(string(b))
}

func toolRestoreDirVersion(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Dir    string `json:"dir"`
		Path   string `json:"path"`
		Hash   string `json:"hash"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	hash := strings.TrimSpace(in.Hash)
	intent := strings.TrimSpace(in.Intent)
	if dir == "" || hash == "" || intent == "" {
		return Fail("请提供 dir、hash 与 intent")
	}
	_ = d
	return Confirm(uuid.NewString(), "回退目录版本 · "+dir, map[string]interface{}{
		"dir": dir, "hash": hash, "intent": intent, "action": "restore_dir_version",
	})
}

// RestoreDirVersionConfirmed 确认后回退目录。
func RestoreDirVersionConfirmed(_ context.Context, d *Deps, argsJSON string) ToolResult {
	var in struct {
		Dir    string `json:"dir"`
		Path   string `json:"path"`
		Hash   string `json:"hash"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal([]byte(argsJSON), &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	hash := strings.TrimSpace(in.Hash)
	if dir == "" || hash == "" {
		return Fail("dir / hash 不能为空")
	}
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	ci, err := d.Notebook.RestoreDirVersion(dir, hash, strings.TrimSpace(in.Intent))
	if err != nil {
		return Fail(err.Error())
	}
	revealNotebook(d, dir, true)
	if d.Radar != nil {
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, dir, "dir-version", dir, true)
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "rel": dir, "restored": hash, "pinned": ci,
		"note": "目录已恢复并创建新版本。",
	})
	return OKData(string(b))
}
