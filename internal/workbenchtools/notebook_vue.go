package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/workbench"
)

type packageNoteViewArgs struct {
	NoteID string `json:"noteId"`
	Skill  string `json:"skill"`
	Intent string `json:"intent"`
}

// toolPackageNoteView 用共用 Vite 构建该笔记的 view/ 工程。
func toolPackageNoteView(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	var in packageNoteViewArgs
	if len(raw) > 0 && json.Unmarshal(raw, &in) != nil {
		return Fail("参数不是 JSON 对象")
	}
	noteID := strings.TrimSpace(in.NoteID)
	if noteID == "" {
		return Fail("noteId 不能为空")
	}
	out, err := d.Notebook.PackageVueView(ctx, noteID, in.Skill)
	if err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil {
		d.Radar.EmitNotebookPath(workbench.RadarOpCreate, []string{out.HTML}, "package-note-view", out.HTML, false)
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, out.HTML, "package-note-view", out.HTML, false)
	}
	return OKData(out)
}
