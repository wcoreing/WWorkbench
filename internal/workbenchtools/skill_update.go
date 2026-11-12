package workbenchtools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

// UpdateSkillArgs 自我更新 Skill 的入参（经验 / 脚本 / 资源 / 优化步骤）。
type UpdateSkillArgs struct {
	Name          string                 `json:"name"`
	Title         string                 `json:"title"`
	Description   string                 `json:"description"`
	Intent        string                 `json:"intent"`
	Lessons       string                 `json:"lessons"`       // 追加到 ## 经验
	Script        string                 `json:"script"`        // 追加脚本正文（不含围栏时可自动包）
	ScriptLang    string                 `json:"scriptLang"`    // bash|sql|…，默认 bash
	ResourcePaths []string               `json:"resourcePaths"` // 本机绝对路径 → 挂到笔记资源
	Steps         []model.WorkflowStepDO `json:"steps"`         // 非空则覆盖步骤（优化路径）
	SourceRunID   string                 `json:"sourceRunId"`
	ReplaceSteps  *bool                  `json:"replaceSteps"` // 显式 false 时忽略 steps
}

func toolUpdateSkill(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in UpdateSkillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	name := strings.TrimSpace(in.Name)
	intent := strings.TrimSpace(in.Intent)
	if name == "" || intent == "" {
		return Fail("请提供 name 与 intent")
	}
	if name == "cms_new_article" {
		return Fail("不能更新内置 cms_new_article")
	}
	hasLessons := strings.TrimSpace(in.Lessons) != ""
	hasScript := strings.TrimSpace(in.Script) != ""
	hasRes := len(in.ResourcePaths) > 0
	replaceSteps := len(in.Steps) > 0
	if in.ReplaceSteps != nil {
		replaceSteps = *in.ReplaceSteps && len(in.Steps) > 0
	}
	hasMeta := strings.TrimSpace(in.Title) != "" || strings.TrimSpace(in.Description) != "" ||
		strings.TrimSpace(in.SourceRunID) != ""
	if !hasLessons && !hasScript && !hasRes && !replaceSteps && !hasMeta {
		return Fail("请至少提供 lessons / script / resourcePaths / steps / description / title 之一")
	}
	summary := "沉淀 Skill · " + name
	preview := map[string]interface{}{
		"name": name, "intent": intent, "action": "update_skill",
		"hasLessons": hasLessons, "hasScript": hasScript,
		"resourceCount": len(in.ResourcePaths), "replaceSteps": replaceSteps,
	}
	return Confirm(uuid.NewString(), summary, preview)
}

// UpdateSkillConfirmed 确认后把经验/脚本/资源/优化步骤写回工作流笔记。
func UpdateSkillConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in UpdateSkillArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	return UpdateSkillNow(d, in)
}

// UpdateSkillNow 写回 Skill 沉淀（UI 可无确认门调用）。
func UpdateSkillNow(d *Deps, in UpdateSkillArgs) ToolResult {
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("name 不能为空")
	}
	cur, err := resolveWorkflowSSOT(d, name)
	if err != nil {
		// 当前任务目录往往只有 log.md：允许带 steps 直接首创 SKILL.md（沉淀到当前任务）
		if len(in.Steps) == 0 {
			return Fail(err.Error() + "；若要新建当前任务 Skill，请传入 steps")
		}
		title := strings.TrimSpace(in.Title)
		if title == "" {
			title = name
		}
		cur = model.WorkflowDO{
			Name:        name,
			Title:       title,
			Description: strings.TrimSpace(in.Description),
			Intent:      strings.TrimSpace(in.Intent),
			Steps:       in.Steps,
			SourceRunID: strings.TrimSpace(in.SourceRunID),
			Source:      "note",
		}
	}
	noteID := firstNonEmpty(cur.NoteID, notebook.SkillNoteID(name))
	existing, _ := d.Notebook.GetNote(noteID)
	extras := notebook.WorkflowNoteBodyExtras{}
	if existing != nil {
		extras = notebook.ExtractWorkflowNoteBodyExtras(existing.Content)
	}

	if v := strings.TrimSpace(in.Title); v != "" {
		cur.Title = v
	}
	if v := strings.TrimSpace(in.Description); v != "" {
		cur.Description = v
	}
	if v := strings.TrimSpace(in.SourceRunID); v != "" {
		cur.SourceRunID = v
	}
	replaceSteps := len(in.Steps) > 0
	if in.ReplaceSteps != nil {
		replaceSteps = *in.ReplaceSteps && len(in.Steps) > 0
	}
	if replaceSteps {
		cur.Steps = in.Steps
	}
	if len(cur.Steps) == 0 {
		return Fail("工作流步骤不能为空（请先 distill 或传入 steps）")
	}

	stamp := time.Now().Format("2006-01-02 15:04")
	if lesson := strings.TrimSpace(in.Lessons); lesson != "" {
		line := fmt.Sprintf("- [%s] %s", stamp, lesson)
		if strings.TrimSpace(extras.Lessons) == "" ||
			strings.Contains(extras.Lessons, "尚无沉淀") {
			extras.Lessons = line
		} else {
			extras.Lessons = strings.TrimSpace(extras.Lessons) + "\n" + line
		}
	}

	if script := strings.TrimSpace(in.Script); script != "" {
		lang := strings.TrimSpace(in.ScriptLang)
		if lang == "" {
			lang = "bash"
		}
		block := script
		if !strings.Contains(script, "```") {
			block = "```" + lang + "\n" + script + "\n```"
		}
		headed := fmt.Sprintf("### 沉淀 %s\n\n%s", stamp, block)
		if strings.TrimSpace(extras.Scripts) == "" || strings.Contains(extras.Scripts, "update_skill(script") {
			extras.Scripts = headed
		} else {
			extras.Scripts = strings.TrimSpace(extras.Scripts) + "\n\n" + headed
		}
	}

	attached := []map[string]interface{}{}
	for _, p := range in.ResourcePaths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		asset, aerr := attachLocalFileToSkillNote(d, noteID, p)
		if aerr != nil {
			return Fail(fmt.Sprintf("挂载资源失败 %s: %s", p, aerr.Error()))
		}
		kind := notebook.SkillResourceKindFile
		if asset.IsImage {
			kind = notebook.SkillResourceKindScreenshot
		}
		attached = append(attached, map[string]interface{}{
			"name": asset.Name, "url": asset.URL, "markdown": asset.Markdown, "kind": kind,
		})
		md := strings.TrimSpace(asset.Markdown)
		if md == "" {
			continue
		}
		line := notebook.FormatSkillResourceLine(kind, stamp+" · "+asset.Name, md)
		if strings.TrimSpace(extras.Resources) == "" ||
			strings.Contains(extras.Resources, "无附件") ||
			strings.Contains(extras.Resources, "update_skill(resourcePaths") ||
			strings.Contains(extras.Resources, "插入附件") {
			head := fmt.Sprintf("> 附件真源：本 Skill 目录 assets/（与 SKILL.md 同级；noteId=%s）。相对链接 assets/文件名。\n\n", noteID)
			extras.Resources = head + line
		} else {
			extras.Resources = strings.TrimSpace(extras.Resources) + "\n" + line
		}
	}

	if intent := strings.TrimSpace(in.Intent); intent != "" {
		cur.Intent = intent
	}
	cur.Source = "update_skill"
	saved, err := d.Notebook.SaveWorkflowNoteWithExtras(cur, extras)
	if err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil && saved.NoteID != "" {
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, saved.NoteID, "workflow-"+saved.Name, saved.Title, true)
	}
	revealNotebook(d, saved.NoteID, true)
	stageBrowser(d, "已沉淀 Skill "+saved.Name)
	out := map[string]interface{}{
		"ok": true, "workflow": saved, "noteId": saved.NoteID,
		"attached": attached,
		"note":     "Skill 已自我更新并创建目录版本（不含 log.md）；list_skill_versions 可回看；下次 get_skill 即生效。",
	}
	if st, e := d.Notebook.ListSkillVersions(saved.Name, 1); e == nil && len(st.Commits) > 0 {
		out["version"] = st.Commits[0]
	}
	return OKData(out)
}

func attachLocalFileToSkillNote(d *Deps, noteID, absPath string) (*model.NotebookAssetDO, error) {
	absPath = filepath.Clean(absPath)
	if !filepath.IsAbs(absPath) {
		return nil, fmt.Errorf("需要绝对路径")
	}
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	name := filepath.Base(absPath)
	mimeType := mime.TypeByExtension(filepath.Ext(name))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	b64 := base64.StdEncoding.EncodeToString(raw)
	return d.Notebook.SaveAsset(model.NotebookAssetUploadDO{
		NoteID: noteID,
		Name:   name,
		MIME:   mimeType,
		Data:   b64,
	})
}
