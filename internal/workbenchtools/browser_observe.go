package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

func toolBrowserStatus(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	out := map[string]interface{}{
		"executors": executorsSnapshot(ctx, d),
		"note":      "任务浏览器操作请走 browser_*（可传 executor=wwb|kimi|agent-browser）；禁止任务场景直连 10086/18765",
	}
	if d != nil && d.Browser != nil {
		st := d.Browser.Status()
		out["listening"] = st.Listening
		out["addr"] = st.Addr
		out["extensionConnected"] = st.ExtensionConnected
		out["extDir"] = st.ExtDir
		out["installHint"] = "Chrome/Edge → 扩展程序 → 加载已解压的扩展程序 → 选择 extDir 目录"
		if st.AttachedTabID != nil {
			out["attachedTabId"] = *st.AttachedTabID
		}
		if st.LastError != "" {
			out["lastError"] = st.LastError
		}
	}
	if b, err := requireBrowser(d); err == nil {
		if data, err := b.Call(ctx, "status", map[string]interface{}{}); err == nil {
			var extra map[string]interface{}
			if json.Unmarshal(data, &extra) == nil {
				for k, v := range extra {
					if _, exists := out[k]; !exists {
						out[k] = v
					}
				}
			}
		}
	}
	stageBrowser(d, "浏览器状态")
	return OKData(out)
}

func toolBrowserListTabs(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	data, err := b.Call(ctx, "list_tabs", map[string]interface{}{})
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "列出标签")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserAttachArgs struct {
	TabID  int64  `json:"tabId"`
	Intent string `json:"intent"`
}

func toolBrowserAttach(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserAttachArgs
	_ = json.Unmarshal(raw, &in)
	if in.TabID <= 0 {
		return Fail("请提供 tabId（先 browser_list_tabs）")
	}
	data, err := b.Call(ctx, "attach", map[string]interface{}{"tabId": in.TabID})
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "附着标签")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserSnapshotArgs struct {
	MaxNodes int    `json:"maxNodes"`
	MaxChars int    `json:"maxChars"`
	Frame    string `json:"frame"`
	Format   string `json:"format"` // json|aria
	Source   string `json:"source"` // ax|dom
}

func toolBrowserSnapshot(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserSnapshotArgs
	_ = json.Unmarshal(raw, &in)
	args := map[string]interface{}{}
	if in.MaxNodes > 0 {
		args["maxNodes"] = in.MaxNodes
	}
	if in.MaxChars > 0 {
		args["maxChars"] = in.MaxChars
	}
	if strings.TrimSpace(in.Frame) != "" {
		args["frame"] = strings.TrimSpace(in.Frame)
	}
	if src := strings.ToLower(strings.TrimSpace(in.Source)); src != "" {
		args["source"] = src
	}
	format := strings.ToLower(strings.TrimSpace(in.Format))
	if format == "" {
		format = "aria" // 默认紧凑文本，加快 Agent 回合
	}
	args["format"] = format
	data, err := b.Call(ctx, "snapshot", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "页面快照")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserFindTabArgs struct {
	URL     string `json:"url"`
	Query   string `json:"query"`
	Active  bool   `json:"active"`
	Session string `json:"session"`
}

func toolBrowserFindTab(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserFindTabArgs
	_ = json.Unmarshal(raw, &in)
	args := map[string]interface{}{}
	if in.Active {
		args["active"] = true
	}
	if q := strings.TrimSpace(in.URL); q != "" {
		args["url"] = q
	} else if q := strings.TrimSpace(in.Query); q != "" {
		args["query"] = q
	}
	if !in.Active && args["url"] == nil && args["query"] == nil {
		return Fail("请提供 url/query，或 active=true（附着用户当前标签）")
	}
	data, err := b.CallSession(ctx, "find_tab", args, strings.TrimSpace(in.Session))
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "定位标签")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserRunArgs struct {
	Steps      []map[string]interface{} `json:"steps"`
	Session    string                   `json:"session"`
	AllowWrite bool                     `json:"allowWrite"`
	Mode       string                   `json:"mode"` // read|write|macro
	Intent     string                   `json:"intent"`
}

func browserRunAllowWrite(in browserRunArgs) bool {
	if in.AllowWrite {
		return true
	}
	m := strings.ToLower(strings.TrimSpace(in.Mode))
	return m == "write" || m == "macro"
}

var browserRunWriteActions = map[string]bool{
	"fill": true, "click": true, "keys": true, "navigate": true,
	"select_option": true, "select": true, "network": true,
}

var browserRunDeniedInMacro = map[string]bool{
	"upload": true, "drag": true, "close_session": true,
}

func toolBrowserRun(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserRunArgs
	_ = json.Unmarshal(raw, &in)
	if len(in.Steps) == 0 {
		return Fail("请提供 steps（只读或 allowWrite 宏）")
	}
	allowWrite := browserRunAllowWrite(in)
	maxSteps := 12
	if allowWrite {
		maxSteps = 16
	}
	if len(in.Steps) > maxSteps {
		return Fail(fmt.Sprintf("steps 最多 %d", maxSteps))
	}
	for i, st := range in.Steps {
		act := strings.ToLower(strings.TrimSpace(fmt.Sprint(st["action"])))
		if act == "" {
			return Fail(fmt.Sprintf("steps[%d] 缺 action", i))
		}
		if browserRunDeniedInMacro[act] {
			return Fail(fmt.Sprintf("宏不允许 %s（请单独调用）", act))
		}
		if !allowWrite && browserRunWriteActions[act] {
			return Fail(fmt.Sprintf("写步骤 %s 需 allowWrite=true 或 mode=macro", act))
		}
	}
	if !allowWrite {
		data, err := b.CallSession(ctx, "run", map[string]interface{}{"steps": in.Steps}, in.Session)
		if err != nil {
			return Fail(err.Error())
		}
		stageBrowser(d, "批量只读")
		var out map[string]interface{}
		if json.Unmarshal(data, &out) != nil {
			return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
		}
		return OKData(out)
	}
	// 可写宏：走确认门（询问关则直接执行）
	preview := withExecutorPreview(raw, map[string]interface{}{
		"action":     "run",
		"allowWrite": true,
		"stepCount":  len(in.Steps),
		"actions":    stepActionsBrief(in.Steps),
		"session":    in.Session,
	})
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := fmt.Sprintf("浏览器宏 %d 步", len(in.Steps))
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserRunConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserRunArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	session := strings.TrimSpace(in.Session)
	args := map[string]interface{}{
		"steps":      in.Steps,
		"allowWrite": true,
	}
	if m := strings.TrimSpace(in.Mode); m != "" {
		args["mode"] = m
	}
	title := session
	if session != "" {
		_ = EnsureTaskRun(ctx, d, session, title, in.Intent, "mcp")
	}
	step := BrowserStepInput{
		Session: session, Tool: workbench.CapBrowserRun, Action: "run", Intent: in.Intent,
		Summary: fmt.Sprintf("宏 %d 步", len(in.Steps)), Title: title,
		Args: map[string]interface{}{
			"allowWrite": true, "stepCount": len(in.Steps), "session": session,
			"actions": stepActionsBrief(in.Steps),
		},
		Approved: true,
	}
	data, err := b.CallSession(ctx, "run", args, session)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, fmt.Sprintf("宏完成 %d 步", len(in.Steps)))
	return recordBrowserOK(ctx, d, step, data)
}

func stepActionsBrief(steps []map[string]interface{}) []string {
	out := make([]string, 0, len(steps))
	for _, st := range steps {
		out = append(out, strings.TrimSpace(fmt.Sprint(st["action"])))
	}
	return out
}

type browserEvaluateArgs struct {
	Code  string `json:"code"`
	Frame string `json:"frame"`
}

func toolBrowserEvaluate(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserEvaluateArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Code) == "" {
		return Fail("请提供 code（建议 IIFE：(() => { ... })()）")
	}
	args := map[string]interface{}{"code": in.Code}
	if strings.TrimSpace(in.Frame) != "" {
		args["frame"] = strings.TrimSpace(in.Frame)
	}
	data, err := b.Call(ctx, "evaluate", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "页内 evaluate")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserReadPageArgs struct {
	MaxChars int    `json:"maxChars"`
	Start    int    `json:"start"`
	Frame    string `json:"frame"`
}

func toolBrowserReadPage(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserReadPageArgs
	_ = json.Unmarshal(raw, &in)
	args := map[string]interface{}{}
	if in.MaxChars > 0 {
		args["maxChars"] = in.MaxChars
	}
	if in.Start > 0 {
		args["start"] = in.Start
	}
	if strings.TrimSpace(in.Frame) != "" {
		args["frame"] = strings.TrimSpace(in.Frame)
	}
	data, err := b.Call(ctx, "read_page", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "读页面正文")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}


type browserNetworkArgs struct {
	Cmd       string `json:"cmd"` // start|stop|list|detail|verify
	Filter    string `json:"filter"`
	Method    string `json:"method"`
	Status    *int   `json:"status"`
	StatusGte *int   `json:"statusGte"`
	StatusLt  *int   `json:"statusLt"`
	RequestID string `json:"requestId"`
	Limit     int    `json:"limit"`
}


func toolBrowserNetwork(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserNetworkArgs
	_ = json.Unmarshal(raw, &in)
	cmd := strings.ToLower(strings.TrimSpace(in.Cmd))
	if cmd == "" {
		cmd = "list"
	}
	args := map[string]interface{}{"cmd": cmd}
	if in.Filter != "" {
		args["filter"] = in.Filter
	}
	if in.Method != "" {
		args["method"] = in.Method
	}
	if in.Status != nil {
		args["status"] = *in.Status
	}
	if in.StatusGte != nil {
		args["statusGte"] = *in.StatusGte
	}
	if in.StatusLt != nil {
		args["statusLt"] = *in.StatusLt
	}
	if in.RequestID != "" {
		args["requestId"] = in.RequestID
	}
	if in.Limit > 0 {
		args["limit"] = in.Limit
	}
	data, err := b.Call(ctx, "network", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "网络 "+cmd)
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}


type browserFindArgs struct {
	Query    string `json:"query"`
	MaxNodes int    `json:"maxNodes"`
	Frame    string `json:"frame"`
}

func toolBrowserFind(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserFindArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Query) == "" {
		return Fail("请提供 query（如「新增方案」）")
	}
	args := map[string]interface{}{"query": in.Query}
	if in.MaxNodes > 0 {
		args["maxNodes"] = in.MaxNodes
	}
	if strings.TrimSpace(in.Frame) != "" {
		args["frame"] = strings.TrimSpace(in.Frame)
	}
	data, err := b.Call(ctx, "find", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "查找 "+truncateRunes(in.Query, 24))
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}

type browserWaitArgs struct {
	Text            string `json:"text"`
	TextGone        string `json:"textGone"`
	NameIncludes    string `json:"nameIncludes"`
	Ref             string `json:"ref"`
	Selector        string `json:"selector"`
	ReadyState      bool   `json:"readyState"`
	TimeoutMs       int    `json:"timeoutMs"`
	Frame           string `json:"frame"`
	IncludeSnapshot *bool  `json:"includeSnapshot"`
}

func toolBrowserWait(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserWaitArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Text) == "" && strings.TrimSpace(in.TextGone) == "" && strings.TrimSpace(in.NameIncludes) == "" &&
		strings.TrimSpace(in.Ref) == "" && strings.TrimSpace(in.Selector) == "" && !in.ReadyState {
		return Fail("请提供 text / textGone / nameIncludes / ref / selector / readyState 之一")
	}
	args := map[string]interface{}{}
	if in.Text != "" {
		args["text"] = in.Text
	}
	if in.TextGone != "" {
		args["textGone"] = in.TextGone
	}
	if in.NameIncludes != "" {
		args["nameIncludes"] = in.NameIncludes
	}
	if in.Ref != "" {
		args["ref"] = in.Ref
	}
	if in.Selector != "" {
		args["selector"] = in.Selector
	}
	if in.ReadyState {
		args["readyState"] = true
	}
	if strings.TrimSpace(in.Frame) != "" {
		args["frame"] = strings.TrimSpace(in.Frame)
	}
	if in.TimeoutMs > 0 {
		args["timeoutMs"] = in.TimeoutMs
	}
	if in.IncludeSnapshot != nil {
		args["includeSnapshot"] = *in.IncludeSnapshot
	}
	data, err := b.Call(ctx, "wait", args)
	if err != nil {
		return Fail(err.Error())
	}
	stageBrowser(d, "等待页面变化")
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		return OKData(map[string]interface{}{"raw": json.RawMessage(data)})
	}
	return OKData(out)
}


type browserScreenshotArgs struct {
	Format  string `json:"format"`
	Quality int    `json:"quality"`
}

func toolBrowserScreenshot(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	b, err := requireBrowserRaw(d, raw)
	if err != nil {
		return Fail(err.Error())
	}
	var in browserScreenshotArgs
	_ = json.Unmarshal(raw, &in)
	args := map[string]interface{}{}
	if in.Format != "" {
		args["format"] = in.Format
	}
	if in.Quality > 0 {
		args["quality"] = in.Quality
	}
	data, err := b.Call(ctx, "screenshot", args)
	if err != nil {
		return Fail(err.Error())
	}
	var shot struct {
		DataURL   string `json:"dataUrl"`
		Path      string `json:"path"`
		SizeBytes int    `json:"sizeBytes"`
		Format    string `json:"format"`
		URL       string `json:"url"`
		Title     string `json:"title"`
		TabID     int64  `json:"tabId"`
		Source    string `json:"source"`
		MimeType  string `json:"mimeType"`
	}
	if json.Unmarshal(data, &shot) != nil {
		return Fail("截图数据无效")
	}
	// Kimi 直出 path；WWB 扩展出 dataUrl
	path := strings.TrimSpace(shot.Path)
	size := shot.SizeBytes
	format := shot.Format
	if path == "" {
		if shot.DataURL == "" {
			return Fail("截图数据无效")
		}
		var err error
		path, size, format, err = saveBrowserShot(shot.DataURL, in.Format)
		if err != nil {
			return Fail(err.Error())
		}
	} else if format == "" {
		if strings.Contains(strings.ToLower(shot.MimeType), "png") || strings.HasSuffix(strings.ToLower(path), ".png") {
			format = "png"
		} else {
			format = "jpeg"
		}
	}
	stageBrowser(d, "已截图")
	out := map[string]interface{}{
		"path":      path,
		"sizeBytes": size,
		"format":    format,
		"url":       shot.URL,
		"title":     shot.Title,
		"note":      "侧栏 Agent 会自动附图进多模态；path 仍可本机打开核对",
	}
	if shot.TabID > 0 {
		out["tabId"] = shot.TabID
	}
	if shot.Source != "" {
		out["source"] = shot.Source
	}
	return OKData(out)
}

