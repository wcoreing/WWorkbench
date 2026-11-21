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
)

// UpdateSkillArgs 自我更新 Skill 的入参（经验 / 脚本 / 资源 / 优化步骤）。
type UpdateSkillArgs struct {
	Name          string                 `json:"name"`
	Title         string                 `json:"title"`
	Description   string                 `json:"description"`
	Intent        string                 `json:"intent"`
	Lessons       string                 `json:"lessons"`       // 追加到 ## 经验
	TrustedOp     string                 `json:"trustedOp"`     // 追加到 ## 已信任操作（确认弹窗信任）
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
	if !updateSkillHasPayload(in) {
		return Fail("请至少提供 lessons / script / resourcePaths / steps / description / title 之一")
	}
	return UpdateSkillNow(d, in)
}

// UpdateSkillConfirmed 兼容确认门回调（现已免确认，等同 UpdateSkillNow）。
func UpdateSkillConfirmed(_ context.Context, d *Deps, argsJSON string) ToolResult {
	var in UpdateSkillArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	return UpdateSkillNow(d, in)
}

func updateSkillHasPayload(in UpdateSkillArgs) bool {
	if strings.TrimSpace(in.Lessons) != "" || strings.TrimSpace(in.Script) != "" || strings.TrimSpace(in.TrustedOp) != "" {
		return true
	}
	if updateSkillWantResources(in) {
		return true
	}
	if updateSkillReplaceSteps(in) {
		return true
	}
	return strings.TrimSpace(in.Title) != "" ||
		strings.TrimSpace(in.Description) != "" ||
		strings.TrimSpace(in.SourceRunID) != ""
}

func updateSkillReplaceSteps(in UpdateSkillArgs) bool {
	if len(in.Steps) == 0 {
		return false
	}
	if in.ReplaceSteps != nil {
		return *in.ReplaceSteps
	}
	return true
}

func updateSkillWantResources(in UpdateSkillArgs) bool {
	for _, p := range in.ResourcePaths {
		if strings.TrimSpace(p) != "" {
			return true
		}
	}
	return false
}

// updateSkillAllowsStepless 无浏览器步骤也可写盘（项目方法 / 纯经验沉淀）。
func updateSkillAllowsStepless(in UpdateSkillArgs) bool {
	if strings.TrimSpace(in.Lessons) != "" || strings.TrimSpace(in.Script) != "" || strings.TrimSpace(in.TrustedOp) != "" {
		return true
	}
	if updateSkillWantResources(in) {
		return true
	}
	return strings.TrimSpace(in.Title) != "" ||
		strings.TrimSpace(in.Description) != "" ||
		strings.Contains(strings.ReplaceAll(strings.TrimSpace(in.Name), "\\", "/"), "/")
}

// textAlreadyInSection 经验/脚本去重：正文已出现则不再追加（避免时间戳导致假变更）。
func textAlreadyInSection(section, piece string) bool {
	piece = strings.TrimSpace(piece)
	section = strings.TrimSpace(section)
	if piece == "" {
		return true
	}
	if section == "" || strings.Contains(section, "尚无沉淀") || strings.Contains(section, "update_skill(script") {
		return false
	}
	return strings.Contains(section, piece)
}

// UpdateSkillNow 写回 Skill 沉淀（免确认）。
// 无实质变更则跳过；有变更则写前 pin 目录版本，再落盘（Save 写后再 pin）。
func UpdateSkillNow(d *Deps, in UpdateSkillArgs) ToolResult {
	if d == nil || d.Notebook == nil {
		return Fail("笔记本未就绪")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("name 不能为空")
	}
	cur, err := resolveWorkflowSSOT(d, name)
	created := false
	if err != nil {
		// 项目/运维等方法 Skill 允许无浏览器步骤，仅 lessons/脚本/说明即可首创。
		if len(in.Steps) == 0 && !updateSkillAllowsStepless(in) {
			return Fail(err.Error() + "；新建 Skill：传完整目录路径 + lessons/description/script，或传入 steps（任务区浏览器步骤）")
		}
		title := strings.TrimSpace(in.Title)
		if title == "" {
			title = notebook.SkillBasename(name)
			if title == "" {
				title = name
			}
		}
		steps := in.Steps
		if steps == nil {
			steps = []model.WorkflowStepDO{}
		}
		cur = model.WorkflowDO{
			Name:        name,
			Title:       title,
			Description: strings.TrimSpace(in.Description),
			Intent:      strings.TrimSpace(in.Intent),
			Steps:       steps,
			SourceRunID: strings.TrimSpace(in.SourceRunID),
			Source:      "note",
		}
		created = true
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
	if updateSkillReplaceSteps(in) {
		cur.Steps = in.Steps
	}
	if cur.Steps == nil {
		cur.Steps = []model.WorkflowStepDO{}
	}
	// 仅「覆盖步骤却给空数组」时拒绝；经验/脚本收口允许 steps=[]。
	if updateSkillReplaceSteps(in) && len(in.Steps) == 0 {
		return Fail("replaceSteps 时 steps 不能为空")
	}

	stamp := time.Now().Format("2006-01-02 15:04")
	lessonsAdded := false
	if lesson := strings.TrimSpace(in.Lessons); lesson != "" {
		if !textAlreadyInSection(extras.Lessons, lesson) {
			line := fmt.Sprintf("- [%s] %s", stamp, lesson)
			if strings.TrimSpace(extras.Lessons) == "" || strings.Contains(extras.Lessons, "尚无沉淀") {
				extras.Lessons = line
			} else {
				extras.Lessons = strings.TrimSpace(extras.Lessons) + "\n" + line
			}
			lessonsAdded = true
		}
	}
	trustedAdded := false
	if trusted := strings.TrimSpace(in.TrustedOp); trusted != "" {
		if !textAlreadyInSection(extras.TrustedOps, trusted) {
			line := trusted
			if !strings.HasPrefix(strings.TrimSpace(line), "-") {
				line = "- " + strings.TrimSpace(line)
			}
			if strings.TrimSpace(extras.TrustedOps) == "" {
				extras.TrustedOps = line
			} else {
				extras.TrustedOps = strings.TrimSpace(extras.TrustedOps) + "\n" + line
			}
			trustedAdded = true
		}
	}

	scriptAdded := false
	if script := strings.TrimSpace(in.Script); script != "" {
		if !textAlreadyInSection(extras.Scripts, script) {
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
			scriptAdded = true
		}
	}

	wantResources := updateSkillWantResources(in)
	if intent := strings.TrimSpace(in.Intent); intent != "" {
		cur.Intent = intent
	}
	cur.Source = "update_skill"

	previewContent := notebook.FormatWorkflowNoteContent(cur, extras)
	contentSame := !created && existing != nil &&
		normalizeSkillContent(existing.Content) == normalizeSkillContent(previewContent)
	if contentSame && !wantResources && !lessonsAdded && !scriptAdded && !trustedAdded {
		out := map[string]interface{}{
			"ok": true, "updated": false, "skipped": true,
			"noteId": noteID, "workflow": cur,
			"note": "内容无实质变更，跳过写盘与版本；list_skill_versions 可回看。",
		}
		if st, e := d.Notebook.ListSkillVersions(name, 1); e == nil && len(st.Commits) > 0 {
			out["version"] = st.Commits[0]
		}
		return OKData(out)
	}

	var beforeVer interface{}
	var beforePinErr string
	if existing != nil {
		msg := "写前检查点"
		if intent := strings.TrimSpace(in.Intent); intent != "" {
			msg = "写前检查点: " + truncateRunes(intent, 48)
		}
		if v, pinErr := d.Notebook.PinSkillVersion(name, msg); pinErr != nil {
			beforePinErr = pinErr.Error()
		} else {
			beforeVer = v
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

	saved, err := d.Notebook.SaveWorkflowNoteWithExtras(cur, extras)
	if err != nil {
		return Fail(err.Error())
	}
	// Skill 跟资源走：项目收口勿切浏览器/工作流产品线，也不自动 reveal 抢走当前页。
	if d.Radar != nil && saved.NoteID != "" {
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, saved.NoteID, "skill-"+saved.Name, saved.Title, false)
	}
	out := map[string]interface{}{
		"ok": true, "updated": true, "skipped": false,
		"workflow": saved, "noteId": saved.NoteID,
		"attached": attached,
		"note":     "已写前打版本并更新 Skill；list_skill_versions / restore_skill_version 可回滚；下次 get_skill 即生效。",
	}
	if beforeVer != nil {
		out["beforeVersion"] = beforeVer
	}
	if beforePinErr != "" {
		out["beforePinError"] = beforePinErr
	}
	if st, e := d.Notebook.ListSkillVersions(saved.Name, 1); e == nil && len(st.Commits) > 0 {
		out["version"] = st.Commits[0]
	}
	return OKData(out)
}

func normalizeSkillContent(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.TrimSpace(s)
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
