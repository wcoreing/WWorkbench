package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

var workflowNameRe = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,47}$`)

// DistillWorkflowFromRun 从任务日志蒸馏 Skill 步骤草稿（参考材料，非必须回放）。
// 只保留成功写步并弱化脆弱 ref；落盘后应再编辑优化路径（合并 fill、删噪声、加 pause）。
func DistillWorkflowFromRun(run model.TaskRunDO, steps []model.TaskStepDO, dropSeqs map[int]bool) []model.WorkflowStepDO {
	out := make([]model.WorkflowStepDO, 0, len(steps))
	for _, st := range steps {
		if dropSeqs[st.Seq] {
			continue
		}
		if !st.OK || !replayableActions[st.Action] {
			continue
		}
		if st.Action == "skip" {
			continue
		}
		loc := rawJSONMap(st.Locator)
		args := rawJSONMap(st.ArgsJSON)
		// 去掉重放元数据
		delete(args, "sourceRunId")
		delete(args, "sourceSeq")
		delete(args, "resolved")
		stableLoc := stabilizeLocator(loc, args, st.Action)
		promoteLocatorFromResult(stableLoc, st.Result)
		stableArgs := stabilizeArgs(args, st.Action)
		if !locatorUsable(stableLoc, stableArgs, st.Action) {
			continue
		}
		out = append(out, model.WorkflowStepDO{
			Action:  st.Action,
			Summary: firstNonEmpty(st.Summary, st.Action),
			Intent:  st.Intent,
			Locator: stableLoc,
			Args:    stableArgs,
		})
	}
	return out
}

func stabilizeLocator(loc, args map[string]interface{}, action string) map[string]interface{} {
	out := map[string]interface{}{}
	for _, k := range []string{"selector", "name", "frame", "url"} {
		if v := strField(loc, k); v != "" {
			out[k] = v
		} else if v := strField(args, k); v != "" && k != "url" {
			// url 优先 locator
			if k == "frame" {
				out[k] = v
			}
			if k == "selector" || k == "name" {
				out[k] = v
			}
		}
	}
	if action == "navigate" {
		url := strField(loc, "url")
		if url == "" {
			url = strField(args, "url")
		}
		if url != "" {
			out["url"] = url
		}
	}
	// 仅当没有 selector/name 时保留 ref（脆弱兜底）
	if strField(out, "selector") == "" && strField(out, "name") == "" {
		if ref := strField(loc, "ref"); ref != "" {
			out["ref"] = ref
		} else if ref := strField(args, "ref"); ref != "" {
			out["ref"] = ref
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// promoteLocatorFromResult：fill/click 结果若带稳定 id，把脆弱 @eN 升级为 #id。
// 避免重放时 ref 序号漂移（如 @e70 从「宠修总和」变成「抗法控制」）。
func promoteLocatorFromResult(loc map[string]interface{}, resultJSON string) {
	if loc == nil || strField(loc, "selector") != "" {
		return
	}
	id := elementIDFromResult(resultJSON)
	if id == "" || !cssIdentRe.MatchString(id) {
		return
	}
	loc["selector"] = "#" + id
	delete(loc, "ref")
}

var cssIdentRe = regexp.MustCompile(`^[A-Za-z_][\w-]*$`)

func elementIDFromResult(resultJSON string) string {
	raw := strings.TrimSpace(resultJSON)
	if raw == "" {
		return ""
	}
	var m map[string]interface{}
	if json.Unmarshal([]byte(raw), &m) != nil {
		return ""
	}
	if id := strField(m, "id"); id != "" {
		return id
	}
	// 兼容嵌套 data.id
	if data, ok := m["data"].(map[string]interface{}); ok {
		return strField(data, "id")
	}
	return ""
}

func stabilizeArgs(args map[string]interface{}, action string) map[string]interface{} {
	if args == nil {
		return nil
	}
	out := map[string]interface{}{}
	switch action {
	case "fill", "select_option":
		if v := strField(args, "value"); v != "" {
			out["value"] = v
		}
		if v := strField(args, "option"); v != "" && strField(out, "value") == "" {
			out["value"] = v
		}
	case "keys":
		if v := strField(args, "keys"); v != "" {
			out["keys"] = v
		}
		if n, ok := args["repeat"]; ok {
			out["repeat"] = n
		}
	case "navigate":
		if v, ok := args["newTab"]; ok {
			out["newTab"] = v
		}
		if v := strField(args, "session"); v != "" {
			out["session"] = v
		}
		if v := strField(args, "group_title"); v != "" {
			out["group_title"] = v
		}
	case "upload":
		if files, ok := args["files"]; ok {
			out["files"] = files
		}
	case "drag":
		for _, k := range []string{"fromRef", "toRef", "fromSelector", "toSelector", "fromX", "fromY", "toX", "toY", "steps"} {
			if v, ok := args[k]; ok {
				out[k] = v
			}
		}
	case "open_frame":
		if v, ok := args["forceNewTab"]; ok {
			out["forceNewTab"] = v
		}
		if v := strField(args, "frame"); v != "" {
			out["frame"] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func locatorUsable(loc, args map[string]interface{}, action string) bool {
	switch action {
	case "navigate":
		return strField(loc, "url") != "" || strField(args, "url") != ""
	case "keys":
		return strField(args, "keys") != ""
	case "upload":
		return args["files"] != nil
	case "open_frame":
		return strField(loc, "frame") != "" || strField(args, "frame") != ""
	case "drag":
		return true
	default:
		return strField(loc, "selector") != "" || strField(loc, "name") != "" || strField(loc, "ref") != "" ||
			strField(args, "selector") != "" || strField(args, "ref") != ""
	}
}

func slugifyWorkflowName(title, session, fallback string) string {
	base := strings.ToLower(strings.TrimSpace(session))
	if base == "" || base == adhocTaskSession {
		base = strings.ToLower(strings.TrimSpace(title))
	}
	if base == "" {
		base = fallback
	}
	var b strings.Builder
	prevDash := false
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		case r == '_' || r == '-':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		case unicode.IsSpace(r):
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "workflow"
	}
	if s[0] >= '0' && s[0] <= '9' {
		s = "p-" + s
	}
	if len(s) > 48 {
		s = s[:48]
	}
	if !workflowNameRe.MatchString(s) {
		s = "workflow"
	}
	return s
}

type distillWorkflowArgs struct {
	RunID       string `json:"runId"`
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	DropSeqs    []int  `json:"dropSeqs"`
	Intent      string `json:"intent"`
}

func toolDistillWorkflow(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in distillWorkflowArgs
	_ = json.Unmarshal(raw, &in)
	runID := strings.TrimSpace(in.RunID)
	if runID == "" {
		return Fail("请提供 runId")
	}
	detail, err := d.Store.GetTaskRunDetail(runID)
	if err != nil {
		return Fail(err.Error())
	}
	drop := map[int]bool{}
	for _, n := range in.DropSeqs {
		drop[n] = true
	}
	steps := DistillWorkflowFromRun(detail.Run, detail.Steps, drop)
	if len(steps) == 0 {
		return Fail("没有可蒸馏的步骤（需成功的写操作，且 locator 可用）")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = slugifyWorkflowName(detail.Run.Title, detail.Run.Session, "from-run")
	}
	if !workflowNameRe.MatchString(name) {
		return Fail("name 须匹配 ^[a-z][a-z0-9_-]{1,47}$（小写字母开头）")
	}
	if name == "cms_new_article" {
		return Fail("cms_new_article 为内置 Skill 名，请换一个 name")
	}
	title := firstNonEmpty(strings.TrimSpace(in.Title), detail.Run.Title, name)
	preview := map[string]interface{}{
		"runId": runID, "name": name, "title": title, "stepCount": len(steps),
		"steps": stepsBrief(steps), "dropSeqs": in.DropSeqs, "action": "distill_workflow",
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "蒸馏 Skill " + name + "（" + fmt.Sprintf("%d", len(steps)) + " 步）"
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

// DistillWorkflowConfirmed 确认后落盘 Skill。
func DistillWorkflowConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	_ = ctx
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in distillWorkflowArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	detail, err := d.Store.GetTaskRunDetail(strings.TrimSpace(in.RunID))
	if err != nil {
		return Fail(err.Error())
	}
	drop := map[int]bool{}
	for _, n := range in.DropSeqs {
		drop[n] = true
	}
	steps := DistillWorkflowFromRun(detail.Run, detail.Steps, drop)
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = slugifyWorkflowName(detail.Run.Title, detail.Run.Session, "from-run")
	}
	title := firstNonEmpty(strings.TrimSpace(in.Title), detail.Run.Title, name)
	intent := firstNonEmpty(strings.TrimSpace(in.Intent), detail.Run.Intent)
	draft := model.WorkflowDO{
		Name:        name,
		Title:       title,
		Description: strings.TrimSpace(in.Description),
		Intent:      intent,
		Steps:       steps,
		SourceRunID: detail.Run.ID,
	}
	p, err := saveWorkflowSSOT(d, draft)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "已保存 工作流笔记 "+p.Name)
	noteHint := "已写入 工作流笔记草稿；请编辑优化后 get_skill 让 Agent 执行（run_skill 仅为可选捷径）。"
	if p.NoteID != "" {
		noteHint = "已写入 工作流笔记 noteId=" + p.NoteID + "；编辑优化 → get_skill；run_skill 可选。"
	}
	return OKData(map[string]interface{}{
		"ok": true, "workflow": p, "noteId": p.NoteID,
		"note": noteHint,
	})
}

func stepsBrief(steps []model.WorkflowStepDO) []string {
	out := make([]string, 0, len(steps))
	for i, st := range steps {
		out = append(out, fmt.Sprintf("%d.%s %s", i+1, st.Action, truncateRunes(st.Summary, 32)))
	}
	return out
}

func toolListWorkflows(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in struct {
		Limit int `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	list, err := listWorkflowsSSOT(d, in.Limit)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"workflows": list,
		"builtin":   []string{"cms_new_article"},
		"total":     len(list),
		"ssot":      "notebook",
	})
}

func toolGetWorkflow(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	}
	_ = json.Unmarshal(raw, &in)
	key := firstNonEmpty(strings.TrimSpace(in.Name), strings.TrimSpace(in.ID))
	if key == "" {
		return Fail("请提供 name 或 id")
	}
	if key == "cms_new_article" {
		return OKData(map[string]interface{}{
			"builtin": true,
			"name":    "cms_new_article",
			"title":   "后台新增方案",
			"source":  "builtin",
			"steps":   []string{"find(新增)", "click", "wait(保存)", "optional fill(title)", "snapshot"},
		})
	}
	p, err := resolveWorkflowSSOT(d, key)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(p)
}

type saveWorkflowArgs struct {
	Name        string                `json:"name"`
	Title       string                `json:"title"`
	Description string                `json:"description"`
	Intent      string                `json:"intent"`
	Steps       []model.WorkflowStepDO `json:"steps"`
	SourceRunID string                `json:"sourceRunId"`
}

func toolSaveWorkflow(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveWorkflowArgs
	_ = json.Unmarshal(raw, &in)
	name := strings.TrimSpace(in.Name)
	if !workflowNameRe.MatchString(name) {
		return Fail("name 须匹配 ^[a-z][a-z0-9_-]{1,47}")
	}
	if name == "cms_new_article" {
		return Fail("不能覆盖内置 cms_new_article")
	}
	if len(in.Steps) == 0 {
		return Fail("steps 不能为空")
	}
	preview := map[string]interface{}{
		"name": name, "title": in.Title, "stepCount": len(in.Steps),
		"steps": stepsBrief(in.Steps), "action": "save_workflow",
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "保存工作流 " + name
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

// SaveWorkflowConfirmed 确认后覆盖保存（笔记 SSOT）。
func SaveWorkflowConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	_ = ctx
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveWorkflowArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	p, err := saveWorkflowSSOT(d, model.WorkflowDO{
		Name:        strings.TrimSpace(in.Name),
		Title:       firstNonEmpty(strings.TrimSpace(in.Title), in.Name),
		Description: strings.TrimSpace(in.Description),
		Intent:      strings.TrimSpace(in.Intent),
		Steps:       in.Steps,
		SourceRunID: strings.TrimSpace(in.SourceRunID),
	})
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "已保存 工作流笔记 "+p.Name)
	return OKData(map[string]interface{}{"ok": true, "workflow": p, "noteId": p.NoteID})
}

type runWorkflowArgs struct {
	Name    string `json:"name"`
	Session string `json:"session"`
	Intent  string `json:"intent"`
	// cms_new_article 内置
	Title string `json:"title"`
	Frame string `json:"frame"`
}

func toolRunWorkflow(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in runWorkflowArgs
	_ = json.Unmarshal(raw, &in)
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("请提供 name（list_skills / list_workflows 或 cms_new_article）")
	}
	if name == "cms_new_article" {
		preview := map[string]interface{}{
			"name": name, "title": in.Title, "frame": in.Frame, "action": "workflow",
			"steps": []string{"find(新增)", "click", "wait(保存)", "optional fill(title)", "snapshot"},
		}
		if in.Intent != "" {
			preview["intent"] = in.Intent
		}
		summary := "Skill：后台新增方案"
		if in.Intent != "" {
			summary = truncateRunes(in.Intent, intentTitleMaxRune)
		}
		stageBrowser(d, summary)
		return Confirm(uuid.NewString(), summary, preview)
	}
	if d.Store == nil {
		return Fail("存储未就绪")
	}
	p, err := resolveWorkflowSSOT(d, name)
	if err != nil {
		return Fail(err.Error())
	}
	preview := map[string]interface{}{
		"name": p.Name, "title": p.Title, "stepCount": len(p.Steps),
		"steps": stepsBrief(p.Steps), "session": in.Session, "action": "run_skill",
		"noteId": p.NoteID, "source": p.Source,
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "运行工作流 " + p.Name
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

// RunWorkflowConfirmed 逐步执行 Skill（一步失败即停，教练式）。
func RunWorkflowConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in runWorkflowArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	name := strings.TrimSpace(in.Name)
	if name == "cms_new_article" {
		return RunBuiltinWorkflowConfirmed(ctx, d, argsJSON)
	}
	return RunStoredWorkflowNow(ctx, d, name, strings.TrimSpace(in.Session), strings.TrimSpace(in.Intent), true)
}

// RunStoredWorkflowNow 可选机械捷径：逐步跑已存 Skill 的浏览器步骤（失败即停）。
// 主路径是 Agent get_skill 后自行用工具完成；UI 也可调本函数做试跑。
func RunStoredWorkflowNow(ctx context.Context, d *Deps, name, session, intent string, approved bool) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	p, err := resolveWorkflowSSOT(d, name)
	if err != nil {
		return Fail(err.Error())
	}
	if len(p.Steps) == 0 {
		return Fail("工作流没有可执行步骤（打开笔记检查 wwb-skill-steps 围栏）")
	}
	runSession := firstNonEmpty(session, "workflow-"+p.Name)
	title := "工作流 · " + firstNonEmpty(p.Title, p.Name)
	_ = EnsureTaskRun(d, runSession, title, firstNonEmpty(intent, p.Intent), "workflow")

	executed := make([]map[string]interface{}, 0, len(p.Steps))
	for i, ps := range p.Steps {
		if ps.Action == "pause" || ps.Action == "coach" {
			msg := firstNonEmpty(ps.Summary, "请人工继续操作")
			RecordBrowserStep(d, BrowserStepInput{
				Session: runSession, Tool: workbench.CapRunSkill, Action: "pause",
				Intent: firstNonEmpty(intent, ps.Intent), Summary: msg,
				Args: map[string]interface{}{"workflow": p.Name, "index": i + 1},
				OK: true, Approved: approved, Source: "workflow", Title: title,
			})
			executed = append(executed, map[string]interface{}{
				"index": i + 1, "action": "pause", "summary": msg,
			})
			CloseTaskRunForSession(d, runSession, "done")
			stageBrowser(d, "工作流暂停 · "+truncateRunes(msg, 40))
			return OKData(map[string]interface{}{
				"ok": true, "paused": true, "workflow": p.Name,
				"at": i + 1, "executed": executed, "total": len(p.Steps),
				"coach": msg,
				"note":  "教练暂停：请在 Chrome 里手工完成，再蒸馏或编辑工作流 加下一步。",
			})
		}
		fake := model.TaskStepDO{
			Seq:      i + 1,
			Action:   ps.Action,
			Summary:  ps.Summary,
			Intent:   firstNonEmpty(ps.Intent, intent),
			ArgsJSON: mustJSON(ps.Args),
			Locator:  mustJSON(ps.Locator),
			OK:       true,
		}
		resolved, note, rerr := resolveReplayTarget(ctx, b, fake)
		if rerr != nil {
			RecordBrowserStep(d, BrowserStepInput{
				Session: runSession, Tool: workbench.CapRunSkill, Action: ps.Action,
				Intent: intent, Summary: fmt.Sprintf("工作流停在 #%d · %s", i+1, ps.Summary),
				OK: false, Error: rerr.Error(), Approved: approved, Source: "workflow", Title: title,
			})
			stageBrowser(d, "工作流定位失败")
			return Fail(fmt.Sprintf("Skill %s 第 %d 步定位失败: %s（已执行 %d 步）", p.Name, i+1, rerr.Error(), len(executed)))
		}
		data, eerr := executeReplayAction(ctx, b, fake, resolved, runSession)
		if eerr != nil {
			RecordBrowserStep(d, BrowserStepInput{
				Session: runSession, Tool: workbench.CapRunSkill, Action: ps.Action,
				Intent: intent, Summary: fmt.Sprintf("工作流失败 #%d · %s", i+1, ps.Summary),
				OK: false, Error: eerr.Error(), Approved: approved, Source: "workflow", Title: title,
			})
			stageBrowser(d, "工作流执行失败")
			return Fail(fmt.Sprintf("Skill %s 第 %d 步失败: %s（已执行 %d 步）", p.Name, i+1, eerr.Error(), len(executed)))
		}
		RecordBrowserStep(d, BrowserStepInput{
			Session: runSession, Tool: workbench.CapRunSkill, Action: ps.Action,
			Intent: firstNonEmpty(intent, ps.Intent), Summary: ps.Summary,
			Args: map[string]interface{}{"workflow": p.Name, "index": i + 1, "resolveNote": note},
			Locator: resolved, Result: data, OK: true, Approved: approved, Source: "workflow", Title: title,
		})
		executed = append(executed, map[string]interface{}{
			"index": i + 1, "action": ps.Action, "summary": ps.Summary, "resolveNote": note,
		})
		stageBrowser(d, fmt.Sprintf("Skill %s · %d/%d", p.Name, i+1, len(p.Steps)))
	}
	CloseTaskRunForSession(d, runSession, "done")
	stageBrowser(d, "工作流完成 "+p.Name)
	coach := "请核对 Chrome；微调请打开 工作流笔记改 wwb-skill-steps 后再运行。"
	if p.NoteID != "" {
		coach = "请核对 Chrome；微调打开笔记 noteId=" + p.NoteID + " 改步骤后再跑。"
	}
	return OKData(map[string]interface{}{
		"ok": true, "workflow": p.Name, "noteId": p.NoteID, "executed": executed, "total": len(p.Steps),
		"coach": coach,
	})
}

func mustJSON(v interface{}) string {
	if v == nil {
		return "{}"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// DistillWorkflowNow UI：无确认门蒸馏。
func DistillWorkflowNow(d *Deps, runID, name, title, description, intent string, dropSeqs []int) ToolResult {
	b, _ := json.Marshal(distillWorkflowArgs{
		RunID: runID, Name: name, Title: title, Description: description, Intent: intent, DropSeqs: dropSeqs,
	})
	return DistillWorkflowConfirmed(context.Background(), d, string(b))
}

// SaveWorkflowNow UI：无确认门保存工作流 步骤（笔记 SSOT）。
func SaveWorkflowNow(d *Deps, p model.WorkflowDO) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	name := strings.TrimSpace(p.Name)
	if !workflowNameRe.MatchString(name) {
		return Fail("name 须匹配 ^[a-z][a-z0-9_-]{1,47}")
	}
	if name == "cms_new_article" {
		return Fail("不能覆盖内置 cms_new_article")
	}
	if len(p.Steps) == 0 {
		return Fail("steps 不能为空")
	}
	saved, err := saveWorkflowSSOT(d, model.WorkflowDO{
		Name:        name,
		Title:       firstNonEmpty(strings.TrimSpace(p.Title), name),
		Description: strings.TrimSpace(p.Description),
		Intent:      strings.TrimSpace(p.Intent),
		Steps:       p.Steps,
		SourceRunID: strings.TrimSpace(p.SourceRunID),
	})
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "已保存 工作流笔记 "+saved.Name)
	return OKData(map[string]interface{}{"ok": true, "workflow": saved, "noteId": saved.NoteID})
}

// saveWorkflowSSOT 只写工作流笔记。
func saveWorkflowSSOT(d *Deps, p model.WorkflowDO) (model.WorkflowDO, error) {
	if d.Notebook == nil {
		return p, errnoWorkflowNotebook()
	}
	saved, err := d.Notebook.SaveWorkflowNote(p)
	if err != nil {
		return p, err
	}
	if d.Radar != nil && saved.NoteID != "" {
		d.Radar.EmitNotebookNote(workbench.RadarOpUpdate, saved.NoteID, "workflow-"+saved.Name, saved.Title, true)
	}
	revealNotebook(d, saved.NoteID, true)
	return saved, nil
}

func resolveWorkflowSSOT(d *Deps, idOrName string) (model.WorkflowDO, error) {
	if d.Notebook == nil {
		return model.WorkflowDO{}, errnoWorkflowNotebook()
	}
	return d.Notebook.ResolveWorkflow(idOrName)
}

func listWorkflowsSSOT(d *Deps, limit int) ([]model.WorkflowDO, error) {
	if d.Notebook == nil {
		return nil, errnoWorkflowNotebook()
	}
	return d.Notebook.ListWorkflowsSSOT(limit), nil
}

func errnoWorkflowNotebook() error {
	return errWorkflowNotebook
}

type workflowNotebookErr struct{}

func (workflowNotebookErr) Error() string { return "笔记本未就绪，无法读写工作流" }

var errWorkflowNotebook workflowNotebookErr
