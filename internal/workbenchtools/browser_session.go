package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

type browserNavigateArgs struct {
	URL        string `json:"url"`
	NewTab     bool   `json:"newTab"`
	Session    string `json:"session"`
	GroupTitle string `json:"group_title"`
	Intent     string `json:"intent"`
}

func toolBrowserNavigate(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserNavigateArgs
	_ = json.Unmarshal(raw, &in)
	if in.URL == "" {
		return Fail("请提供 url")
	}
	preview := map[string]interface{}{
		"url":         in.URL,
		"newTab":      in.NewTab,
		"session":     in.Session,
		"group_title": in.GroupTitle,
		"action":      "navigate",
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "浏览器打开 " + truncateRunes(in.URL, 60)
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserNavigateConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserNavigateArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{
		"url":    in.URL,
		"newTab": in.NewTab,
	}
	if strings.TrimSpace(in.GroupTitle) != "" {
		args["group_title"] = strings.TrimSpace(in.GroupTitle)
	}
	session := strings.TrimSpace(in.Session)
	title := strings.TrimSpace(in.GroupTitle)
	if title == "" {
		title = session
	}
	if session != "" {
		_ = EnsureTaskRun(d, session, title, in.Intent, "mcp")
	}
	step := BrowserStepInput{
		Session: session, Tool: workbench.CapBrowserNavigate, Action: "navigate", Intent: in.Intent,
		Summary: "导航 " + truncateRunes(in.URL, 60), Title: title,
		Args: args, Locator: map[string]interface{}{"url": in.URL}, Approved: true,
	}
	data, err := b.CallSession(ctx, "navigate", args, session)
	if err != nil {
		return recordBrowserFail(d, step, err)
	}
	stageBrowser(d, "已导航")
	return recordBrowserOK(d, step, data)
}

type browserCloseSessionArgs struct {
	Session string `json:"session"`
}

func toolBrowserCloseSession(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserCloseSessionArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Session) == "" {
		return Fail("请提供 session（任务名）；关闭该任务标签组内 Agent 打开的标签，借用的用户标签保留")
	}
	data, err := b.CallSession(ctx, "close_session", map[string]interface{}{"session": in.Session}, in.Session)
	if err != nil {
		return Fail(err.Error())
	}
	RecordBrowserStep(d, BrowserStepInput{
		Session: in.Session, Tool: workbench.CapBrowserCloseSession, Action: "close_session",
		Summary: "关闭任务组 " + truncateRunes(in.Session, 24), OK: true, Result: data,
	})
	CloseTaskRunForSession(d, in.Session, "done")
	stageBrowser(d, "关闭任务组 "+truncateRunes(in.Session, 24))
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserGroupSessionArgs struct {
	Session     string  `json:"session"`
	GroupTitle  string  `json:"group_title"`
	URLIncludes string  `json:"urlIncludes"`
	TabIDs      []int64 `json:"tabIds"`
}

func toolBrowserGroupSession(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserGroupSessionArgs
	_ = json.Unmarshal(raw, &in)
	title := strings.TrimSpace(in.GroupTitle)
	if title == "" {
		title = "舞台任务"
	}
	session := strings.TrimSpace(in.Session)
	args := map[string]interface{}{
		"session":     session,
		"group_title": title,
		"urlIncludes": strings.TrimSpace(in.URLIncludes),
		"borrowed":    true,
	}
	if len(in.TabIDs) > 0 {
		ids := make([]int, 0, len(in.TabIDs))
		for _, id := range in.TabIDs {
			ids = append(ids, int(id))
		}
		args["tabIds"] = ids
	}
	if args["urlIncludes"] == "" && len(in.TabIDs) == 0 {
		return Fail("请提供 urlIncludes（如 xiaohongshu.com）或 tabIds")
	}
	_ = EnsureTaskRun(d, session, title, "", "mcp")
	data, err := b.CallSession(ctx, "group_session", args, session)
	if err != nil {
		return Fail(err.Error())
	}
	RecordBrowserStep(d, BrowserStepInput{
		Session: session, Tool: workbench.CapBrowserGroupSession, Action: "group_session",
		Summary: "标签组 " + truncateRunes(title, 24), Title: title, Args: args, OK: true, Result: data,
	})
	stageBrowser(d, "标签组 "+truncateRunes(title, 24))
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

func toolBrowserOpen(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	d.UIActions.Dispatch(UIActionBrowserOpen, map[string]interface{}{})
	return OKData(map[string]interface{}{
		"opened": true,
		"note":   "已切换到浏览器舞台",
	})
}

type browserOpenFrameArgs struct {
	Frame       string `json:"frame"`
	ForceNewTab bool   `json:"forceNewTab"`
	Intent      string `json:"intent"`
}

func toolBrowserOpenFrame(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserOpenFrameArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Frame) == "" {
		return Fail("请提供 frame（如 #f1）")
	}
	preview := map[string]interface{}{
		"frame":       in.Frame,
		"forceNewTab": in.ForceNewTab,
		"action":      "open_frame",
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "打开 iframe " + in.Frame
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserOpenFrameConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserOpenFrameArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{"frame": in.Frame, "forceNewTab": in.ForceNewTab}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserOpenFrame, Action: "open_frame", Intent: in.Intent,
		Summary: "打开 iframe " + in.Frame, Args: args, Locator: locatorFrom("", "", "", in.Frame), Approved: true,
	}
	data, err := b.Call(ctx, "open_frame", args)
	if err != nil {
		return recordBrowserFail(d, step, err)
	}
	stageBrowser(d, "已处理 iframe")
	return recordBrowserOK(d, step, data)
}

type builtinWorkflowArgs struct {
	Name   string `json:"name"`
	Title  string `json:"title"`
	Frame  string `json:"frame"`
	Intent string `json:"intent"`
}

func RunBuiltinWorkflowConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var head struct {
		Name string `json:"name"`
	}
	_ = json.Unmarshal([]byte(argsJSON), &head)
	name := strings.TrimSpace(head.Name)
	if name == "" {
		name = "cms_new_article"
	}
	if name != "cms_new_article" {
		return RunWorkflowConfirmed(ctx, d, argsJSON)
	}
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in builtinWorkflowArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	frame := strings.TrimSpace(in.Frame)
	steps := []map[string]interface{}{}

	findArgs := map[string]interface{}{"query": "新增", "maxNodes": 200}
	if frame != "" {
		findArgs["frame"] = frame
	}
	findRaw, err := b.Call(ctx, "find", findArgs)
	if err != nil {
		return Fail("查找「新增」失败: " + err.Error())
	}
	var found struct {
		Matches []struct {
			Ref  string `json:"ref"`
			Name string `json:"name"`
		} `json:"matches"`
	}
	_ = json.Unmarshal(findRaw, &found)
	if len(found.Matches) == 0 {
		return Fail("未找到名称含「新增」的按钮，请确认已附着文章后台页")
	}
	ref := found.Matches[0].Ref
	steps = append(steps, map[string]interface{}{"step": "find", "ref": ref, "name": found.Matches[0].Name})

	clickArgs := map[string]interface{}{"ref": ref, "mode": "auto"}
	if frame != "" {
		clickArgs["frame"] = frame
	}
	clickRaw, err := b.Call(ctx, "click", clickArgs)
	if err != nil {
		return Fail("点击失败: " + err.Error())
	}
	steps = append(steps, map[string]interface{}{"step": "click", "ref": ref, "raw": json.RawMessage(clickRaw)})

	waitArgs := map[string]interface{}{"nameIncludes": "保存", "timeoutMs": 8000}
	if frame != "" {
		waitArgs["frame"] = frame
	}
	waitRaw, _ := b.Call(ctx, "wait", waitArgs)
	steps = append(steps, map[string]interface{}{"step": "wait", "raw": json.RawMessage(waitRaw)})

	title := strings.TrimSpace(in.Title)
	if title != "" {
		findTitleArgs := map[string]interface{}{"query": "标题", "maxNodes": 200}
		if frame != "" {
			findTitleArgs["frame"] = frame
		}
		// 优先找 placeholder「如 AI」类输入；找不到则跳过 fill
		find2, _ := b.Call(ctx, "find", map[string]interface{}{"query": "如 AI", "maxNodes": 200, "frame": frame})
		var found2 struct {
			Matches []struct {
				Ref  string `json:"ref"`
				Role string `json:"role"`
			} `json:"matches"`
		}
		_ = json.Unmarshal(find2, &found2)
		fillRef := ""
		for _, m := range found2.Matches {
			if m.Role == "text" || m.Role == "textbox" || m.Role == "input" {
				fillRef = m.Ref
				break
			}
		}
		if fillRef != "" {
			fillArgs := map[string]interface{}{"ref": fillRef, "value": title}
			if frame != "" {
				fillArgs["frame"] = frame
			}
			fillRaw, ferr := b.Call(ctx, "fill", fillArgs)
			if ferr == nil {
				steps = append(steps, map[string]interface{}{"step": "fill", "ref": fillRef, "raw": json.RawMessage(fillRaw)})
			}
		} else {
			_ = findTitleArgs
			steps = append(steps, map[string]interface{}{"step": "fill", "skipped": true, "reason": "未定位到标题输入框，请人工填入"})
		}
	}

	snapArgs := map[string]interface{}{"maxNodes": 200}
	if frame != "" {
		snapArgs["frame"] = frame
	}
	snapRaw, _ := b.Call(ctx, "snapshot", snapArgs)
	stageBrowser(d, "工作流完成：新增方案")
	result, _ := json.Marshal(map[string]interface{}{
		"workflow": "cms_new_article",
		"steps":    steps,
	})
	runID := RecordBrowserStep(d, BrowserStepInput{
		Tool: workbench.CapRunSkill, Action: "workflow", Intent: in.Intent,
		Summary: "工作流 cms_new_article", Title: "cms_new_article",
		Args: map[string]interface{}{"name": "cms_new_article", "title": in.Title, "frame": frame},
		Result: result, OK: true, Approved: true,
	})
	return OKData(map[string]interface{}{
		"ok":       true,
		"workflow": "cms_new_article",
		"steps":    steps,
		"snapshot": json.RawMessage(snapRaw),
		"taskRunId": runID,
		"note":     "若已填标题，请在快照中找「保存」并 browser_click 确认落库；未填则先 fill 再保存",
	})
}
