package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"
)

type publishAgentSkillArgs struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	NoteID      string `json:"noteId"`
}

// toolPublishAgentSkill 将笔记标为工作流（role=skill）；真源仅笔记本磁盘目录。
func toolPublishAgentSkill(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	_ = ctx
	var in publishAgentSkillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	noteID := strings.TrimSpace(in.NoteID)
	id := strings.TrimSpace(in.ID)
	name := strings.TrimSpace(in.Name)
	desc := strings.TrimSpace(in.Description)
	content := strings.TrimSpace(in.Content)

	if noteID == "" || d == nil || d.Notebook == nil {
		return Fail("请提供 noteId（工作流真源为笔记本）")
	}
	n, err := d.Notebook.GetNote(noteID)
	if err != nil {
		return Fail(err.Error())
	}
	if id == "" {
		id = notebook.ReadLinkedSkillID(n.Content)
	}
	if id == "" {
		if p, ok := notebook.ParseWorkflowNote(*n); ok && strings.TrimSpace(p.Name) != "" {
			id = strings.TrimSpace(p.Name)
		}
	}
	if id == "" {
		id = notebook.SkillNameFromNoteID(n.ID)
	}
	if id == "" {
		id = notebook.SuggestSkillID(n.Title, n.ID)
	}
	if content == "" {
		content = notebook.SkillBodyFromNote(n.Content)
	}
	if name == "" {
		name = strings.TrimSpace(n.Title)
	}
	if desc == "" {
		if fm, _, ok := notebook.PeekFrontmatter(n.Content); ok {
			desc = notebook.FrontmatterString(fm, "description")
			if desc == "" {
				desc = notebook.FrontmatterString(fm, "intent")
			}
		}
	}
	if id == "" {
		return Fail("id 不能为空")
	}
	content = notebook.SkillBodyFromNote(content)
	if content == "" {
		content = notebook.StripSkillMark(strings.TrimSpace(in.Content))
	}
	if content == "" {
		return Fail("content 不能为空")
	}

	saved, err := d.Notebook.MarkNoteAsSkill(noteID, id)
	if err != nil {
		return Fail("笔记标记工作流失败: " + err.Error())
	}
	if saved != nil {
		noteID = saved.ID
	}
	if d.Radar != nil {
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, noteID, id, name, false)
	}
	noteIDOut, skillDir, assetsDir, _ := d.Notebook.ResolveSkillPaths(id)
	if noteIDOut == "" {
		noteIDOut = noteID
	}
	out := map[string]any{
		"ok": true, "id": id, "name": firstNonEmpty(name, id), "description": desc,
		"noteId": noteIDOut, "role": "skill", "ssot": "notebook",
		"skillDir": skillDir, "assetsDir": assetsDir,
		"note": "已将笔记标为工作流「" + id + "」。路径：" + skillDir + "；get_skill / run_skill 直读笔记。",
	}
	b, _ := json.Marshal(out)
	return OKData(string(b))
}

type updateAgentSkillArgs struct {
	ID            string   `json:"id"`
	Content       string   `json:"content"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	UpdateContent *bool    `json:"updateContent"`
	UpdateGlobs   bool     `json:"updateGlobs"`
	Globs         []string `json:"globs"`
}

// toolUpdateAgentSkill 已废弃磁盘投影；请用 update_skill 写笔记本工作流。
func toolUpdateAgentSkill(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	_ = d
	var in updateAgentSkillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	return Fail("已取消 system/skills 投影。请用 update_skill(name=\"" + id + "\", …) 或直接改笔记本 工作流/" + id + "/SKILL.md")
}
