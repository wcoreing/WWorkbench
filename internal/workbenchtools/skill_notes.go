package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
)

// toolListSkills 列出笔记本工作流（role=skill；磁盘 ~/.wworkbench/notebook/工作流/）。
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
	seen := map[string]struct{}{}
	out := make([]item, 0, 32)

	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}

	appendItem := func(id, title, desc, noteID string, hasSteps bool) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		noteID, skillDir, assetsDir, _ := d.Notebook.ResolveSkillPaths(id)
		out = append(out, item{
			ID: id, Name: firstNonEmpty(strings.TrimSpace(title), id),
			Description: desc, NoteID: noteID,
			DiskPath: skillDir, SkillDir: skillDir, AssetsDir: assetsDir,
			Source: "notebook", HasSteps: hasSteps,
		})
	}

	list, err := d.Notebook.ListSkillNotes(80)
	if err != nil {
		return Fail(err.Error())
	}
	for _, sum := range list {
		n, err := d.Notebook.GetNote(sum.ID)
		if err != nil || n == nil {
			continue
		}
		id := notebook.ReadLinkedSkillID(n.Content)
		if id == "" {
			if p, ok := notebook.ParseWorkflowNote(*n); ok && p.Name != "" {
				id = p.Name
			}
		}
		if id == "" {
			id = notebook.SkillNameFromNoteID(n.ID)
		}
		if id == "" {
			id = notebook.SuggestSkillID(n.Title, n.ID)
		}
		desc := ""
		hasSteps := false
		if p, ok := notebook.ParseWorkflowNote(*n); ok {
			desc = firstNonEmpty(p.Description, p.Intent)
			hasSteps = len(p.Steps) > 0
			if p.Name != "" {
				id = p.Name
			}
		}
		if desc == "" {
			if fm, _, ok := notebook.PeekFrontmatter(n.Content); ok {
				desc = notebook.FrontmatterString(fm, "description")
			}
		}
		appendItem(id, n.Title, desc, n.ID, hasSteps)
	}

	b, _ := json.Marshal(map[string]any{"ok": true, "skills": out, "total": len(out), "ssot": "notebook"})
	return OKData(string(b))
}

// toolGetSkill 读取笔记本工作流正文；返回 diskPath / skillDir / assetsDir。
func toolGetSkill(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
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
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}

	n, ok := findSkillNote(d.Notebook, key)
	if !ok {
		return Fail("未找到工作流：" + key + "（仅笔记本 ~/.wworkbench/notebook/工作流/）")
	}
	body := notebook.SkillBodyFromNote(n.Content)
	if body == "" {
		body = strings.TrimSpace(n.Content)
	}
	hasSteps := false
	runName := key
	if p, pok := notebook.ParseWorkflowNote(*n); pok {
		hasSteps = len(p.Steps) > 0
		if p.Name != "" {
			runName = p.Name
		}
	}
	if name := notebook.SkillNameFromNoteID(n.ID); name != "" {
		runName = name
	}
	noteID, skillDir, assetsDir, _ := d.Notebook.ResolveSkillPaths(runName)
	if noteID == "" {
		noteID = n.ID
	}
	diskFile := ""
	if p, err := d.Notebook.NoteDiskPath(noteID); err == nil {
		diskFile = p
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "id": runName, "name": firstNonEmpty(n.Title, runName),
		"noteId": noteID, "source": "notebook", "hasSteps": hasSteps,
		"diskPath": diskFile, "skillDir": skillDir, "assetsDir": assetsDir,
		"content": body,
		"run":     map[string]any{"tool": "run_skill", "name": runName, "note": "可选机械捷径；优先读正文后由 Agent 用工具执行"},
	})
	return OKData(string(b))
}

type noteGetter interface {
	GetNote(id string) (*model.NoteDO, error)
	ListSkillNotes(limit int) ([]model.NoteSummaryDO, error)
	ListWorkflowNotes(limit int) ([]model.WorkflowDO, error)
}

func findSkillNote(nb noteGetter, key string) (*model.NoteDO, bool) {
	key = strings.TrimSpace(key)
	if key == "" || nb == nil {
		return nil, false
	}
	try := []string{key, notebook.SkillNoteID(key)}
	for _, id := range try {
		if id == "" {
			continue
		}
		n, err := nb.GetNote(id)
		if err == nil && n != nil {
			return n, true
		}
	}
	if list, err := nb.ListSkillNotes(100); err == nil {
		for _, sum := range list {
			n, err := nb.GetNote(sum.ID)
			if err != nil || n == nil {
				continue
			}
			if notebook.ReadLinkedSkillID(n.Content) == key {
				return n, true
			}
			if p, ok := notebook.ParseWorkflowNote(*n); ok && p.Name == key {
				return n, true
			}
			if notebook.SkillNameFromNoteID(n.ID) == key {
				return n, true
			}
			if strings.EqualFold(strings.TrimSpace(n.Title), key) {
				return n, true
			}
		}
	}
	if pbs, err := nb.ListWorkflowNotes(80); err == nil {
		for _, p := range pbs {
			if p.Name == key || p.NoteID == key || p.ID == key {
				n, err := nb.GetNote(p.NoteID)
				if err == nil && n != nil {
					return n, true
				}
			}
		}
	}
	return nil, false
}
