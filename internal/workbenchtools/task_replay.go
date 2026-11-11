package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

// 可重放的写动作（只读/收口类跳过）。
var replayableActions = map[string]bool{
	"navigate":      true,
	"click":         true,
	"fill":          true,
	"keys":          true,
	"select_option": true,
	"upload":        true,
	"drag":          true,
	"open_frame":    true,
}

type replayTaskStepArgs struct {
	RunID  string `json:"runId"`
	Seq    int    `json:"seq"` // 0=下一可重放步（相对上次），否则指定 seq
	Skip   bool   `json:"skip"`
	Intent string `json:"intent"`
}

func toolReplayTaskStep(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if _, err := requireBrowser(d); err != nil {
		return Fail(err.Error())
	}
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in replayTaskStepArgs
	_ = json.Unmarshal(raw, &in)
	runID := strings.TrimSpace(in.RunID)
	if runID == "" {
		return Fail("请提供 runId（来自 list_task_runs）")
	}
	detail, err := d.Store.GetTaskRunDetail(runID)
	if err != nil {
		return Fail(err.Error())
	}
	step, err := pickReplayStep(detail.Steps, in.Seq)
	if err != nil {
		return Fail(err.Error())
	}
	if in.Skip {
		preview := map[string]interface{}{
			"runId": runID, "seq": step.Seq, "action": step.Action, "summary": step.Summary,
			"skip": true, "note": "将跳过该步并记一条 skipped",
		}
		if in.Intent != "" {
			preview["intent"] = in.Intent
		}
		summary := "跳过重放 · " + truncateRunes(step.Summary, 40)
		if in.Intent != "" {
			summary = truncateRunes(in.Intent, intentTitleMaxRune)
		}
		stageBrowser(d, summary)
		return Confirm(uuid.NewString(), summary, preview)
	}
	preview := map[string]interface{}{
		"runId":    runID,
		"seq":      step.Seq,
		"action":   step.Action,
		"summary":  step.Summary,
		"locator":  rawJSONMap(step.Locator),
		"args":     rawJSONMap(step.ArgsJSON),
		"original": step.Intent,
		"coach":    "将按 locator 重新 find，再执行；失败会停在舞台上让你改。",
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	summary := "重放 #" + fmt.Sprintf("%d", step.Seq) + " · " + truncateRunes(step.Summary, 36)
	if in.Intent != "" {
		summary = truncateRunes(in.Intent, intentTitleMaxRune)
	}
	stageBrowser(d, summary)
	return Confirm(uuid.NewString(), summary, preview)
}

// ReplayTaskStepConfirmed MCP 确认后执行/跳过一步。
func ReplayTaskStepConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in replayTaskStepArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	return ReplayTaskStepNow(ctx, d, strings.TrimSpace(in.RunID), in.Seq, in.Skip, strings.TrimSpace(in.Intent), true)
}

// ReplayTaskStepNow 执行重放一步（UI 教练条可 skipConfirm）。
func ReplayTaskStepNow(ctx context.Context, d *Deps, runID string, seq int, skip bool, intent string, approved bool) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	b, err := requireBrowser(d)
	if err != nil {
		return Fail(err.Error())
	}
	detail, err := d.Store.GetTaskRunDetail(runID)
	if err != nil {
		return Fail(err.Error())
	}
	step, err := pickReplayStep(detail.Steps, seq)
	if err != nil {
		return Fail(err.Error())
	}
	// 试跑不落独立「重放」会话（左栏不刷新产品录制）；结果走舞台状态栏 + 返回日志字段。
	_ = approved

	if skip || !replayableActions[step.Action] {
		note := "skipped"
		if !replayableActions[step.Action] {
			note = "不可自动重放: " + step.Action
		}
		next := nextReplayableSeq(detail.Steps, step.Seq)
		logLine := note + " · #" + fmt.Sprintf("%d", step.Seq) + " " + step.Summary
		if strings.TrimSpace(intent) != "" {
			logLine = truncateRunes(intent, 36) + " · " + logLine
		}
		stageBrowser(d, "已跳过 #" + fmt.Sprintf("%d", step.Seq))
		return OKData(map[string]interface{}{
			"ok": true, "skipped": true, "seq": step.Seq, "action": step.Action,
			"sourceRunId": runID, "nextSeq": next, "log": logLine,
			"coach": "可继续 replay_task_step 下一步，或在舞台点「执行」。",
		})
	}

	resolved, resolveNote, rerr := resolveReplayTarget(ctx, b, step)
	if rerr != nil {
		stageBrowser(d, "重放定位失败")
		return Fail(rerr.Error() + "；请 snapshot/find 后人工处理，或 skip=true 跳过")
	}

	data, execErr := executeReplayAction(ctx, b, step, resolved, detail.Run.Session)
	if execErr != nil {
		stageBrowser(d, "重放执行失败")
		return Fail(execErr.Error())
	}

	next := nextReplayableSeq(detail.Steps, step.Seq)
	logLine := "重放 · #" + fmt.Sprintf("%d", step.Seq) + " · " + truncateRunes(step.Summary, 40)
	stageBrowser(d, "已重放 #" + fmt.Sprintf("%d", step.Seq) + " · " + truncateRunes(step.Summary, 24))
	return OKData(map[string]interface{}{
		"ok": true, "seq": step.Seq, "action": step.Action, "resolved": resolved,
		"resolveNote": resolveNote, "sourceRunId": runID,
		"nextSeq": next, "log": logLine,
		"raw":   json.RawMessage(data),
		"coach": "核对 Chrome 后再调下一步；不要盲打。",
	})
}

// FinishReplaySession 兼容旧版：收口历史上误建的 replay-* 会话。
func FinishReplaySession(d *Deps, sourceRunID string) {
	if d == nil || strings.TrimSpace(sourceRunID) == "" {
		return
	}
	CloseTaskRunForSession(d, "replay-"+shortID(sourceRunID), "done")
}

func pickReplayStep(steps []model.TaskStepDO, seq int) (model.TaskStepDO, error) {
	if len(steps) == 0 {
		return model.TaskStepDO{}, fmt.Errorf("该任务没有步骤")
	}
	if seq > 0 {
		for _, st := range steps {
			if st.Seq == seq {
				return st, nil
			}
		}
		return model.TaskStepDO{}, fmt.Errorf("找不到 seq=%d", seq)
	}
	for _, st := range steps {
		if replayableActions[st.Action] {
			return st, nil
		}
	}
	return steps[0], nil
}

func nextReplayableSeq(steps []model.TaskStepDO, after int) interface{} {
	for _, st := range steps {
		if st.Seq > after && replayableActions[st.Action] {
			return st.Seq
		}
	}
	return nil
}

func rawJSONMap(s string) map[string]interface{} {
	s = strings.TrimSpace(s)
	if s == "" || s == "{}" {
		return map[string]interface{}{}
	}
	var m map[string]interface{}
	if json.Unmarshal([]byte(s), &m) != nil {
		return map[string]interface{}{}
	}
	return m
}

func resolveReplayTarget(ctx context.Context, b bridgeCaller, step model.TaskStepDO) (map[string]interface{}, string, error) {
	loc := rawJSONMap(step.Locator)
	args := rawJSONMap(step.ArgsJSON)
	frame := strField(loc, "frame")
	if frame == "" {
		frame = strField(args, "frame")
	}
	out := map[string]interface{}{}
	if frame != "" {
		out["frame"] = frame
	}

	switch step.Action {
	case "navigate":
		url := strField(loc, "url")
		if url == "" {
			url = strField(args, "url")
		}
		if url == "" {
			return nil, "", fmt.Errorf("导航步缺少 url")
		}
		out["url"] = url
		if v, ok := args["newTab"]; ok {
			out["newTab"] = v
		}
		return out, "url", nil
	case "keys":
		keys := strField(args, "keys")
		if keys == "" {
			// summary like "按键 Enter"
			if strings.HasPrefix(step.Summary, "按键 ") {
				keys = strings.TrimPrefix(step.Summary, "按键 ")
			}
		}
		if keys == "" {
			return nil, "", fmt.Errorf("按键步缺少 keys")
		}
		out["keys"] = keys
		if n, ok := args["repeat"]; ok {
			out["repeat"] = n
		}
	case "upload":
		if files, ok := args["files"]; ok {
			out["files"] = files
		} else {
			return nil, "", fmt.Errorf("上传步缺少 files")
		}
	case "open_frame":
		fr := strField(args, "frame")
		if fr == "" {
			fr = frame
		}
		if fr == "" {
			return nil, "", fmt.Errorf("open_frame 缺少 frame")
		}
		out["frame"] = fr
		if v, ok := args["forceNewTab"]; ok {
			out["forceNewTab"] = v
		}
		return out, "frame", nil
	case "drag":
		// 尽量用 from/to selector 或 ref
		for _, k := range []string{"fromRef", "toRef", "fromSelector", "toSelector", "fromX", "fromY", "toX", "toY", "steps"} {
			if v, ok := args[k]; ok {
				out[k] = v
			}
		}
		return out, "drag-args", nil
	case "wait":
		// 条件可来自 args 或 locator.name（→ nameIncludes）
		for _, k := range []string{"text", "textGone", "nameIncludes", "ref", "selector", "readyState", "timeoutMs", "frame"} {
			if v, ok := args[k]; ok {
				out[k] = v
			}
		}
		if strField(out, "nameIncludes") == "" {
			if n := strField(loc, "name"); n != "" {
				out["nameIncludes"] = n
			} else if n := strField(args, "name"); n != "" {
				out["nameIncludes"] = n
			}
		}
		if strField(out, "selector") == "" {
			if s := strField(loc, "selector"); s != "" {
				out["selector"] = s
			}
		}
		if strField(out, "ref") == "" {
			if r := strField(loc, "ref"); r != "" {
				out["ref"] = r
			}
		}
		if strField(out, "text") == "" && strField(out, "textGone") == "" &&
			strField(out, "nameIncludes") == "" && strField(out, "ref") == "" &&
			strField(out, "selector") == "" && strField(out, "readyState") == "" {
			return nil, "", fmt.Errorf("wait 步缺少 text / textGone / nameIncludes / ref / selector / readyState")
		}
		return out, "wait", nil
	case "fill", "select_option":
		if step.Action == "fill" {
			val := strField(args, "value")
			if val == "" {
				return nil, "", fmt.Errorf("填表步无 value（旧日志未存值）；请人工 fill 或 skip")
			}
			out["value"] = val
		} else {
			val := strField(args, "value")
			if val == "" {
				val = strField(args, "option")
			}
			if val == "" {
				return nil, "", fmt.Errorf("下拉步缺少 value")
			}
			out["value"] = val
		}
	}

	selector := strField(loc, "selector")
	if selector == "" {
		selector = strField(args, "selector")
	}
	name := strField(loc, "name")
	ref := strField(loc, "ref")
	if ref == "" {
		ref = strField(args, "ref")
	}

	if selector != "" {
		out["selector"] = selector
		return out, "selector", nil
	}
	if name != "" {
		// click：name 交给桥（含 CDP AX）；很多按钮不进 aria，find 会空结果。
		// fill/select 仍走 find→ref（content fill 需要节点）。
		if step.Action == "click" {
			out["name"] = name
			return out, "name", nil
		}
		findArgs := map[string]interface{}{"query": name, "maxNodes": 200}
		if frame != "" {
			findArgs["frame"] = frame
		}
		raw, err := b.Call(ctx, "find", findArgs)
		if err != nil {
			return nil, "", fmt.Errorf("按 name 查找失败: %w", err)
		}
		var found struct {
			Matches []struct {
				Ref  string `json:"ref"`
				Name string `json:"name"`
			} `json:"matches"`
		}
		_ = json.Unmarshal(raw, &found)
		if len(found.Matches) == 0 {
			return nil, "", fmt.Errorf("未找到名称含「%s」的节点，请人工 find 或 skip", name)
		}
		out["ref"] = found.Matches[0].Ref
		out["name"] = found.Matches[0].Name
		return out, "name→" + found.Matches[0].Ref, nil
	}
	if ref != "" {
		// 先 snapshot 刷新 @eN，再碰运气；教练模式应优先 name/selector
		snapArgs := map[string]interface{}{"maxNodes": 200}
		if frame != "" {
			snapArgs["frame"] = frame
		}
		_, _ = b.Call(ctx, "snapshot", snapArgs)
		out["ref"] = ref
		return out, "ref(fragile)", nil
	}
	if step.Action == "keys" {
		// 可无目标（打到焦点）
		return out, "keys-focus", nil
	}
	return nil, "", fmt.Errorf("步骤 #%d 无可用 locator（需 selector / name / ref）", step.Seq)
}

type bridgeCaller interface {
	Call(ctx context.Context, action string, args interface{}) (json.RawMessage, error)
	CallSession(ctx context.Context, action string, args interface{}, session string) (json.RawMessage, error)
}

func executeReplayAction(ctx context.Context, b bridgeCaller, step model.TaskStepDO, resolved map[string]interface{}, sourceSession string) (json.RawMessage, error) {
	switch step.Action {
	case "navigate":
		args := rawJSONMap(step.ArgsJSON)
		session := firstNonEmpty(sourceSession, strField(args, "session"))
		nav := map[string]interface{}{}
		for k, v := range resolved {
			nav[k] = v
		}
		if v, ok := args["newTab"]; ok {
			nav["newTab"] = v
		}
		if v := strField(args, "group_title"); v != "" {
			nav["group_title"] = v
		}
		return b.CallSession(ctx, "navigate", nav, session)
	case "click":
		args := map[string]interface{}{"mode": "auto"}
		for _, k := range []string{"ref", "selector", "name", "frame"} {
			if v, ok := resolved[k]; ok {
				args[k] = v
			}
		}
		return b.Call(ctx, "click", args)
	case "fill":
		return b.Call(ctx, "fill", resolved)
	case "select_option":
		return b.Call(ctx, "select_option", resolved)
	case "keys":
		return b.Call(ctx, "keys", resolved)
	case "upload":
		return b.Call(ctx, "upload", resolved)
	case "drag":
		return b.Call(ctx, "drag", resolved)
	case "wait":
		raw, err := b.Call(ctx, "wait", resolved)
		if err != nil {
			return raw, err
		}
		var wr struct {
			Matched  bool `json:"matched"`
			TimedOut bool `json:"timedOut"`
		}
		_ = json.Unmarshal(raw, &wr)
		if wr.TimedOut || !wr.Matched {
			return raw, fmt.Errorf("wait 超时未满足条件")
		}
		return raw, nil
	case "open_frame":
		return b.Call(ctx, "open_frame", resolved)
	default:
		return nil, fmt.Errorf("不支持重放: %s", step.Action)
	}
}

func strField(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func shortID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}
