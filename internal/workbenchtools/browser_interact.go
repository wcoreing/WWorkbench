package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

type browserUploadArgs struct {
	Ref      string   `json:"ref"`
	Selector string   `json:"selector"`
	Files    []string `json:"files"`
	Frame    string   `json:"frame"`
	Intent   string   `json:"intent"`
}

func toolBrowserUpload(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserUploadArgs
	_ = json.Unmarshal(raw, &in)
	if len(in.Files) == 0 {
		return Fail("请提供 files（本机绝对路径数组）")
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"ref":      in.Ref,
		"selector": in.Selector,
		"files":    in.Files,
		"frame":    in.Frame,
		"action":   "upload",
	})
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "浏览器上传 " + fmt.Sprintf("%d 个文件", len(in.Files))
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserUploadConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserUploadArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{"files": in.Files}
	if in.Ref != "" {
		args["ref"] = in.Ref
	}
	if in.Selector != "" {
		args["selector"] = in.Selector
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserUpload, Action: "upload", Intent: in.Intent, Summary: "上传文件",
		Args: args, Locator: locatorFrom(in.Ref, in.Selector, "", in.Frame), Approved: true,
	}
	data, err := b.Call(ctx, "upload", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, "已上传文件")
	return recordBrowserOK(ctx, d, step, data)
}


type browserSelectOptionArgs struct {
	Ref      string `json:"ref"`
	Selector string `json:"selector"`
	Value    string `json:"value"`
	Option   string `json:"option"`
	Frame    string `json:"frame"`
	Intent   string `json:"intent"`
}

func toolBrowserSelectOption(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserSelectOptionArgs
	_ = json.Unmarshal(raw, &in)
	val := strings.TrimSpace(in.Value)
	if val == "" {
		val = strings.TrimSpace(in.Option)
	}
	if val == "" {
		return Fail("请提供 value/option（选项文案）")
	}
	if in.Ref == "" && in.Selector == "" {
		return Fail("请提供下拉触发器 ref 或 selector")
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"ref": in.Ref, "selector": in.Selector, "value": val, "frame": in.Frame, "action": "select_option",
	})
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "选择下拉项 " + truncateRunes(val, 40)
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserSelectOptionConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserSelectOptionArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	val := strings.TrimSpace(in.Value)
	if val == "" {
		val = strings.TrimSpace(in.Option)
	}
	args := map[string]interface{}{"value": val}
	if in.Ref != "" {
		args["ref"] = in.Ref
	}
	if in.Selector != "" {
		args["selector"] = in.Selector
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserSelectOption, Action: "select_option", Intent: in.Intent,
		Summary: "选择 " + truncateRunes(val, 40), Args: args,
		Locator: locatorFrom(in.Ref, in.Selector, "", in.Frame), Approved: true,
	}
	data, err := b.Call(ctx, "select_option", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, "已选下拉项")
	return recordBrowserOK(ctx, d, step, data)
}

type browserDragArgs struct {
	FromRef      string  `json:"fromRef"`
	ToRef        string  `json:"toRef"`
	FromSelector string  `json:"fromSelector"`
	ToSelector   string  `json:"toSelector"`
	FromX        float64 `json:"fromX"`
	FromY        float64 `json:"fromY"`
	ToX          float64 `json:"toX"`
	ToY          float64 `json:"toY"`
	Steps        int     `json:"steps"`
	Frame        string  `json:"frame"`
	Intent       string  `json:"intent"`
}

func toolBrowserDrag(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserDragArgs
	_ = json.Unmarshal(raw, &in)
	if in.FromRef == "" && in.FromSelector == "" && in.FromX == 0 && in.FromY == 0 {
		// 无法区分「真 0」与未传；要求至少有 ref/selector
		if in.ToRef == "" && in.ToSelector == "" {
			return Fail("请提供 fromRef/toRef 或 fromSelector/toSelector（或坐标对）")
		}
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"fromRef": in.FromRef, "toRef": in.ToRef,
		"fromSelector": in.FromSelector, "toSelector": in.ToSelector,
		"action": "drag", "frame": in.Frame,
	})
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "浏览器拖拽"
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserDragConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserDragArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{}
	if in.FromRef != "" {
		args["fromRef"] = in.FromRef
	}
	if in.ToRef != "" {
		args["toRef"] = in.ToRef
	}
	if in.FromSelector != "" {
		args["fromSelector"] = in.FromSelector
	}
	if in.ToSelector != "" {
		args["toSelector"] = in.ToSelector
	}
	if in.FromX != 0 || in.FromY != 0 {
		args["fromX"] = in.FromX
		args["fromY"] = in.FromY
	}
	if in.ToX != 0 || in.ToY != 0 {
		args["toX"] = in.ToX
		args["toY"] = in.ToY
	}
	if in.Steps > 0 {
		args["steps"] = in.Steps
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserDrag, Action: "drag", Intent: in.Intent, Summary: "拖拽",
		Args: args, Approved: true,
	}
	data, err := b.Call(ctx, "drag", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, "已拖拽")
	return recordBrowserOK(ctx, d, step, data)
}


type browserClickArgs struct {
	Ref             string `json:"ref"`
	Selector        string `json:"selector"`
	Name            string `json:"name"`
	Mode            string `json:"mode"` // auto|pointer|dom
	Frame           string `json:"frame"`
	Intent          string `json:"intent"`
	IncludeSnapshot interface{} `json:"includeSnapshot"` // true|false|"ax"|"probe"
	Observation     string      `json:"observation"`     // ax|probe|false
}

func toolBrowserClick(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserClickArgs
	_ = json.Unmarshal(raw, &in)
	if in.Ref == "" && in.Selector == "" {
		return Fail("请提供 ref（快照中的 @eN）或 selector")
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"ref":      in.Ref,
		"selector": in.Selector,
		"mode":     in.Mode,
		"frame":    in.Frame,
		"action":   "click",
	})
	if in.Name != "" {
		preview["name"] = in.Name
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	if in.IncludeSnapshot != nil {
		preview["includeSnapshot"] = in.IncludeSnapshot
	}
	if in.Observation != "" {
		preview["observation"] = in.Observation
	}
	summary := "浏览器点击"
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	} else if in.Ref != "" {
		summary = "浏览器点击 " + in.Ref
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserClickConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserClickArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{
		"ref":      in.Ref,
		"selector": in.Selector,
	}
	if in.Name != "" {
		args["name"] = in.Name
	}
	if in.Mode != "" {
		args["mode"] = in.Mode
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	if in.IncludeSnapshot != nil {
		args["includeSnapshot"] = in.IncludeSnapshot
	}
	if strings.TrimSpace(in.Observation) != "" {
		args["observation"] = strings.TrimSpace(in.Observation)
	}
	copyWaitForArgs(argsJSON, args)
	step := BrowserStepInput{
		Tool: workbench.CapBrowserClick, Action: "click", Intent: in.Intent,
		Summary: "点击", Args: args, Locator: locatorFrom(in.Ref, in.Selector, in.Name, in.Frame), Approved: true,
	}
	if in.Name != "" {
		step.Summary = "点击 " + truncateRunes(in.Name, 40)
	} else if in.Ref != "" {
		step.Summary = "点击 " + in.Ref
	}
	data, err := b.Call(ctx, "click", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, "已点击")
	return recordBrowserOK(ctx, d, step, data)
}


type browserKeysArgs struct {
	Keys     string `json:"keys"`
	Ref      string `json:"ref"`
	Selector string `json:"selector"`
	Repeat   int    `json:"repeat"`
	Frame    string `json:"frame"`
	Intent   string `json:"intent"`
}

func toolBrowserKeys(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserKeysArgs
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.Keys) == "" {
		return Fail("请提供 keys（如 Enter、Escape、Mod+A）")
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"keys":     in.Keys,
		"ref":      in.Ref,
		"selector": in.Selector,
		"repeat":   in.Repeat,
		"frame":    in.Frame,
		"action":   "keys",
	})
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "浏览器按键 " + truncateRunes(in.Keys, 24)
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserKeysConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserKeysArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{"keys": in.Keys}
	if in.Ref != "" {
		args["ref"] = in.Ref
	}
	if in.Selector != "" {
		args["selector"] = in.Selector
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	if in.Repeat > 0 {
		args["repeat"] = in.Repeat
	}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserKeys, Action: "keys", Intent: in.Intent,
		Summary: "按键 " + in.Keys, Args: args, Locator: locatorFrom(in.Ref, in.Selector, "", in.Frame), Approved: true,
	}
	data, err := b.Call(ctx, "keys", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	stageBrowser(d, "已发送按键")
	return recordBrowserOK(ctx, d, step, data)
}


type browserFillField struct {
	Ref      string `json:"ref"`
	Selector string `json:"selector"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	Option   string `json:"option"`
	Frame    string `json:"frame"`
	Action   string `json:"action"` // fill | select_option
}

type browserFillArgs struct {
	Ref             string             `json:"ref"`
	Selector        string             `json:"selector"`
	Value           string             `json:"value"`
	Frame           string             `json:"frame"`
	Intent          string             `json:"intent"`
	IncludeSnapshot *bool              `json:"includeSnapshot"` // 默认 false；true 时填后带回 AX
	Observation     string             `json:"observation"`     // ax|probe|false；批填成功后可选
	Fields          []browserFillField `json:"fields"`          // 多字段一次往返；与单字段二选一
}

func fillFieldValue(f browserFillField) string {
	if strings.TrimSpace(f.Value) != "" {
		return f.Value
	}
	return strings.TrimSpace(f.Option)
}

func toolBrowserFill(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	var in browserFillArgs
	_ = json.Unmarshal(raw, &in)
	batch := len(in.Fields) > 0
	if batch {
		if len(in.Fields) > 20 {
			return Fail("fields 最多 20 项")
		}
		for i, f := range in.Fields {
			if fillFieldValue(f) == "" {
				return Fail(fmt.Sprintf("fields[%d] 缺 value", i))
			}
			if strings.TrimSpace(f.Ref) == "" && strings.TrimSpace(f.Selector) == "" && strings.TrimSpace(f.Name) == "" {
				return Fail(fmt.Sprintf("fields[%d] 需 ref / selector / name", i))
			}
		}
	} else if in.Ref == "" && in.Selector == "" {
		return Fail("请提供 ref/selector，或 fields[] 批填")
	} else if strings.TrimSpace(in.Value) == "" {
		return Fail("请提供 value，或改用 fields[]")
	}
	preview := withExecutorPreview(raw, map[string]interface{}{
		"frame":  in.Frame,
		"action": "fill",
		"batch":  batch,
	})
	if batch {
		briefs := make([]map[string]interface{}, 0, len(in.Fields))
		for _, f := range in.Fields {
			act := strings.TrimSpace(f.Action)
			if act == "" {
				act = "fill"
			}
			briefs = append(briefs, map[string]interface{}{
				"ref": f.Ref, "selector": f.Selector, "name": f.Name,
				"value": truncateRunes(fillFieldValue(f), 80), "action": act,
			})
		}
		preview["fields"] = briefs
		preview["fieldCount"] = len(in.Fields)
	} else {
		preview["ref"] = in.Ref
		preview["selector"] = in.Selector
		preview["value"] = truncateRunes(in.Value, 120)
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "浏览器填表"
	if batch {
		summary = fmt.Sprintf("浏览器批填 %d 项", len(in.Fields))
	}
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

func BrowserFillConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	b, err := requireBrowserRaw(d, json.RawMessage(argsJSON))
	if err != nil {
		return Fail(err.Error())
	}
	var in browserFillArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	args := map[string]interface{}{}
	batch := len(in.Fields) > 0
	if batch {
		fields := make([]map[string]interface{}, 0, len(in.Fields))
		for _, f := range in.Fields {
			item := map[string]interface{}{"value": fillFieldValue(f)}
			if f.Ref != "" {
				item["ref"] = f.Ref
			}
			if f.Selector != "" {
				item["selector"] = f.Selector
			}
			if f.Name != "" {
				item["name"] = f.Name
			}
			if f.Frame != "" {
				item["frame"] = f.Frame
			}
			if act := strings.TrimSpace(f.Action); act != "" {
				item["action"] = act
			}
			fields = append(fields, item)
		}
		args["fields"] = fields
	} else {
		args["ref"] = in.Ref
		args["selector"] = in.Selector
		args["value"] = in.Value
	}
	if in.Frame != "" {
		args["frame"] = in.Frame
	}
	if in.IncludeSnapshot != nil {
		args["includeSnapshot"] = *in.IncludeSnapshot
	}
	if obs := strings.TrimSpace(in.Observation); obs != "" {
		args["observation"] = obs
	}
	stepArgs := map[string]interface{}{"frame": in.Frame, "batch": batch}
	if batch {
		stepArgs["fieldCount"] = len(in.Fields)
	} else {
		stepArgs["ref"] = in.Ref
		stepArgs["selector"] = in.Selector
		stepArgs["value"] = in.Value
		stepArgs["valueLen"] = len(in.Value)
	}
	summary := "填表"
	if batch {
		summary = fmt.Sprintf("批填 %d 项", len(in.Fields))
	}
	step := BrowserStepInput{
		Tool: workbench.CapBrowserFill, Action: "fill", Intent: in.Intent, Summary: summary,
		Args: stepArgs, Locator: locatorFrom(in.Ref, in.Selector, "", in.Frame), Approved: true,
	}
	data, err := b.Call(ctx, "fill", args)
	step.Provider = b.Provider()
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	if batch {
		stageBrowser(d, fmt.Sprintf("已批填 %d 项", len(in.Fields)))
	} else {
		stageBrowser(d, "已填表")
	}
	return recordBrowserOK(ctx, d, step, data)
}

