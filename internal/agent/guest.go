package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/agent/agentchoice"
	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/harness"
	"WWorkbench/internal/model"
	"WWorkbench/internal/turnctx"
	"WWorkbench/internal/workbenchtools"

	"github.com/google/uuid"
	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/history"
	"github.com/wcoreing/ningharness/lifecycle"
	"github.com/wcoreing/ningharness/memory"

	einomodel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

const (
	maxAgentSteps        = 30
	maxChoiceJSONRetries = 3
	/** 同一轮连续进度轮询上限：超过则结束本轮，交给用户继续。 */
	maxProgressPolls = 3
)

// workbenchGuest：history + harness.Complete（框架流式）+ Gateway 工具。
type workbenchGuest struct {
	r        *Runner
	threadID string
	taskID   string
	ctxSnap  model.AgentContextDO
	cm       einomodel.ToolCallingChatModel
	waiting  bool
	mode     string
}

func (g *workbenchGuest) Run(ctx context.Context, in guest.Input) (string, error) {
	if g == nil || g.r == nil || g.r.harness == nil || g.cm == nil {
		return "", fmt.Errorf("guest: harness/model 未就绪")
	}
	_ = in
	root := g.r.harness.Root
	_ = history.EnsureSystem(root, g.threadID, g.r.systemPrompt(g.mode))

	perms := g.r.store.GetToolPermissions()
	toolDefs := g.r.listToolDefs(perms, g.mode)
	toolInfos, err := toSchemaTools(toolDefs)
	if err != nil {
		return "", err
	}

	choiceJSONRetries := 0
	progressPolls := 0
	for step := 0; step < maxAgentSteps; step++ {
		if ctx.Err() != nil {
			g.r.emit("agent:done", map[string]interface{}{"threadId": g.threadID, "stopped": true})
			return "", ctx.Err()
		}
		all, err := history.Load(root, g.threadID)
		if err != nil {
			return "", err
		}
		var lastUser *history.Msg
		for i := len(all) - 1; i >= 0; i-- {
			if all[i].Role == "user" {
				cp := all[i]
				lastUser = &cp
				break
			}
		}
		bounded := history.BuildForModel(all, history.DefaultBudget(), true)
		msgs := historyToSchema(g.r.harness.Root, g.r.systemPrompt(g.mode), bounded, lastUser)
		hadMedia := schemaHasUserMedia(msgs)
		out, err := g.r.harness.Complete(ctx, g.cm, msgs, toolInfos)
		if err != nil {
			return "", guest.RewriteGenerateError(err, hadMedia)
		}

		type plannedCall struct {
			id, name string
			args     json.RawMessage
		}
		planned := make([]plannedCall, 0, len(out.ToolCalls))
		var specs []history.ToolCallSpec
		for _, tc := range out.ToolCalls {
			name := tc.Function.Name
			if name == "" {
				continue
			}
			id := strings.TrimSpace(tc.ID)
			if id == "" {
				id = uuid.NewString()
			}
			args := "{}"
			if tc.Function.Arguments != "" {
				args = tc.Function.Arguments
			}
			planned = append(planned, plannedCall{id: id, name: name, args: json.RawMessage(args)})
			specs = append(specs, history.ToolCallSpec{
				ID: id, Name: name, Arguments: args,
			})
		}
		asstContent := out.Content

		if len(planned) == 0 {
			if retry, valErr := choiceJSONRetry(asstContent, choiceJSONRetries, maxChoiceJSONRetries); retry {
				choiceJSONRetries++
				_ = history.Append(root, g.threadID, history.Msg{
					Role: "assistant", Content: asstContent, TaskID: g.taskID,
				})
				_ = history.Append(root, g.threadID, history.Msg{
					Role: "user", Content: agentchoice.RetryUserMessage(valErr), TaskID: g.taskID,
				})
				continue
			}
			seq, _ := history.AppendSeq(root, g.threadID, history.Msg{
				Role: "assistant", Content: asstContent, TaskID: g.taskID,
			})
			if asstContent != "" {
				payload := map[string]interface{}{
					"threadId": g.threadID, "content": asstContent,
				}
				if seq > 0 {
					payload["seq"] = seq
				}
				if ids := g.r.threadSkillIDs(g.threadID); len(ids) > 0 {
					payload["skillIds"] = ids
				}
				g.r.emit("agent:assistant", payload)
			}
			g.r.emit("agent:done", map[string]interface{}{"threadId": g.threadID})
			return asstContent, nil
		}

		_ = history.Append(root, g.threadID, history.Msg{
			Role: "assistant", Content: asstContent,
			ToolCallsJSON: history.EncodeToolCalls(specs), TaskID: g.taskID,
		})

		var awaiting []confirmAwaitItem

		for _, pc := range planned {
			callID, name := pc.id, pc.name
			args := pc.args
			if len(args) == 0 {
				args = json.RawMessage("{}")
			}
			if name == "get_workbench_context" {
				args = mergeWorkbenchContext(args, g.ctxSnap)
			}
			if name == "get_note" {
				args = mergeNoteID(args, g.ctxSnap)
			}
			_, _, _ = g.r.harness.PutToolCall(g.threadID, g.taskID, callID, name, string(args))
			g.r.emit("agent:tool_start", map[string]interface{}{
				"threadId": g.threadID, "tool": name, "args": string(args), "taskId": g.taskID,
			})

			if perms != nil && !harness.IsMemoryTool(name) && !workbenchtools.IsToolEnabled(perms, name) {
				fail := workbenchtools.Fail("该能力已在 AI 权限设置中关闭: " + name)
				_ = g.appendToolResult(root, callID, fail, 0)
				appendToolErrorNote(ctx, name+": "+fail.Error)
				continue
			}
			if deny := toolDeniedByMode(g.mode, name); deny != "" {
				fail := workbenchtools.Fail(deny)
				_ = g.appendToolResult(root, callID, fail, 0)
				appendToolErrorNote(ctx, name+": "+fail.Error)
				continue
			}

			result := g.r.harness.CallTool(ctx, name, args)
			if result.NeedsConfirm {
				_ = g.r.store.SaveAgentPendingFull(callID, g.threadID, g.taskID, name, string(args), result.ConfirmSummary)
				awaiting = append(awaiting, confirmAwaitItem{
					callID: callID, name: name, summary: result.ConfirmSummary,
					preview: json.RawMessage(result.Data),
				})
				g.r.emit("agent:tool_end", map[string]interface{}{
					"threadId": g.threadID, "tool": name,
					"status": StatusNeedConfirm, "summary": result.ConfirmSummary,
				})
				continue
			}

			if isProgressPollTool(name) {
				progressPolls++
			} else {
				progressPolls = 0
			}
			if progressPolls >= maxProgressPolls {
				nudge := "【系统】已连续多次查看终端/进度。长任务请向用户汇报当前进度并结束本轮；请用户到终端面板看进度，完成后说「继续」或「查进度」。禁止本轮继续空转等待。"
				if result.OK {
					result.Data = appendJSONNote(result.Data, nudge)
				} else {
					result.Error = strings.TrimSpace(result.Error + "\n" + nudge)
				}
			}

			body, _ := json.Marshal(result)
			rid, _, _ := g.r.harness.PutToolResult(g.threadID, g.taskID, callID, name, string(body))
			st, summary := toolStatus(name, result)
			if rid > 0 {
				summary = fmt.Sprintf("%s · #%d", summary, rid)
			}
			_ = g.appendToolResult(root, callID, result, rid)
			if !result.OK && !result.NeedsConfirm {
				note := name + ": " + strings.TrimSpace(result.Error)
				if note == name+": " {
					note = name + ": " + summary
				}
				appendToolErrorNote(ctx, note)
			}
			payload := map[string]interface{}{
				"threadId": g.threadID, "tool": name,
				"status": st, "summary": summary, "result": result,
			}
			if rid > 0 {
				payload["resourceId"] = rid
			}
			g.r.emit("agent:tool_end", payload)

			if progressPolls >= maxProgressPolls {
				msg := "长任务仍在进行中。请到终端面板查看实时进度；完成后告诉我「继续」，或再说「查一下进度」。本轮不再空转等待。"
				seq, _ := history.AppendSeq(root, g.threadID, history.Msg{
					Role: "assistant", Content: msg, TaskID: g.taskID,
				})
				payload := map[string]interface{}{
					"threadId": g.threadID, "content": msg,
				}
				if seq > 0 {
					payload["seq"] = seq
				}
				g.r.emit("agent:assistant", payload)
				g.r.emit("agent:done", map[string]interface{}{"threadId": g.threadID})
				return msg, nil
			}
		}

		if len(awaiting) > 0 {
			g.waiting = true
			items := make([]map[string]interface{}, 0, len(awaiting))
			for _, a := range awaiting {
				items = append(items, map[string]interface{}{
					"pendingId": a.callID, "tool": a.name,
					"summary": a.summary, "preview": a.preview,
				})
			}
			first := awaiting[0]
			g.r.emit("agent:needs_confirm", map[string]interface{}{
				"threadId":  g.threadID,
				"pendingId": first.callID,
				"tool":      first.name,
				"summary":   batchConfirmSummary(awaiting),
				"preview":   first.preview,
				"items":     items,
			})
			g.r.emit("agent:done", map[string]interface{}{"threadId": g.threadID, "waitingConfirm": true})
			if st := lifecycle.RunStateFrom(ctx); st != nil {
				st.Set("waiting_confirm", true)
			}
			return "", nil
		}
	}
	return "", fmt.Errorf("已达到最大工具调用步数")
}

type confirmAwaitItem struct {
	callID, name, summary string
	preview               json.RawMessage
}

func batchConfirmSummary(items []confirmAwaitItem) string {
	if len(items) == 0 {
		return "有操作待确认"
	}
	if len(items) == 1 {
		if s := strings.TrimSpace(items[0].summary); s != "" {
			return s
		}
		return items[0].name + " 待确认"
	}
	byTool := map[string]int{}
	for _, it := range items {
		byTool[it.name]++
	}
	if len(byTool) == 1 {
		for name, n := range byTool {
			switch name {
			case "remove_container":
				return fmt.Sprintf("拟删除 %d 个容器（需确认）", n)
			case "stop_container":
				return fmt.Sprintf("拟停止 %d 个容器（需确认）", n)
			case "start_container":
				return fmt.Sprintf("拟启动 %d 个容器（需确认）", n)
			case "execute_sql":
				return fmt.Sprintf("拟执行 %d 条 SQL（需确认）", n)
			case "execute_http":
				return fmt.Sprintf("拟执行 %d 个 HTTP 请求（需确认）", n)
			default:
				return fmt.Sprintf("拟执行 %d 次 %s（需确认）", n, name)
			}
		}
	}
	return fmt.Sprintf("拟执行 %d 项需确认操作", len(items))
}

func (g *workbenchGuest) appendToolResult(root, callID string, result workbenchtools.ToolResult, rid int64) error {
	content := formatToolMessage(result, rid)
	ids := ""
	if rid > 0 {
		ids = history.EncodeResourceIDs([]int64{rid})
	}
	return history.Append(root, g.threadID, history.Msg{
		Role: "tool", ToolCallID: callID, TaskID: g.taskID,
		Content: content, ResourceIDsJSON: ids,
	})
}

func appendToolErrorNote(ctx context.Context, note string) {
	note = strings.TrimSpace(note)
	if note == "" {
		return
	}
	st := lifecycle.RunStateFrom(ctx)
	if st == nil {
		return
	}
	errs := memory.ToolErrorsFromValues(st.Values)
	for _, e := range errs {
		if e == note {
			return
		}
	}
	errs = append(errs, note)
	st.Set(memory.ToolErrorsValueKey, errs)
}

func mergeWorkbenchContext(args json.RawMessage, snap model.AgentContextDO) json.RawMessage {
	var merged map[string]interface{}
	_ = json.Unmarshal(args, &merged)
	if merged == nil {
		merged = map[string]interface{}{}
	}
	turnctx.ApplySnapshot(merged, snap)
	out, _ := json.Marshal(merged)
	return out
}

func mergeNoteID(args json.RawMessage, snap model.AgentContextDO) json.RawMessage {
	var merged map[string]interface{}
	_ = json.Unmarshal(args, &merged)
	if merged == nil {
		merged = map[string]interface{}{}
	}
	cur, _ := merged["noteId"].(string)
	if strings.TrimSpace(cur) == "" && strings.TrimSpace(snap.NoteID) != "" {
		merged["noteId"] = snap.NoteID
	}
	out, _ := json.Marshal(merged)
	return out
}

func isProgressPollTool(name string) bool {
	return name == "get_shell_output"
}

func appendJSONNote(data json.RawMessage, note string) json.RawMessage {
	note = strings.TrimSpace(note)
	if note == "" {
		return data
	}
	var obj map[string]interface{}
	if len(data) > 0 && json.Unmarshal(data, &obj) == nil && obj != nil {
		obj["_agentHint"] = note
		out, err := json.Marshal(obj)
		if err == nil {
			return out
		}
	}
	wrapped := map[string]interface{}{
		"result":     json.RawMessage(data),
		"_agentHint": note,
	}
	out, _ := json.Marshal(wrapped)
	return out
}

func toSchemaTools(defs []workbenchtools.ToolDef) ([]*schema.ToolInfo, error) {
	out := make([]*schema.ToolInfo, 0, len(defs))
	for _, d := range defs {
		ti, err := guest.ToolInfoFromJSONSchema(d.Name, d.Description, d.Parameters)
		if err != nil {
			return nil, err
		}
		out = append(out, ti)
	}
	return out, nil
}

func historyToSchema(root, system string, bounded []history.Msg, lastUser *history.Msg) []*schema.Message {
	out := []*schema.Message{schema.SystemMessage(system)}
	lastSeq := -1
	if lastUser != nil {
		lastSeq = lastUser.Seq
	}
	for _, m := range bounded {
		switch m.Role {
		case "user":
			text, refs := history.SplitImageRefs(m.Content)
			if lastUser != nil && m.Seq == lastSeq {
				cp := *lastUser
				cp.Content = text
				text = history.WireUser(cp)
			}
			out = append(out, guest.UserMessage(text, loadUserImages(root, refs)))
		case "assistant":
			var tcs []schema.ToolCall
			if m.ToolCallsJSON != "" {
				var specs []history.ToolCallSpec
				if json.Unmarshal([]byte(m.ToolCallsJSON), &specs) == nil {
					for _, sp := range specs {
						tcs = append(tcs, schema.ToolCall{
							ID:   sp.ID,
							Type: "function",
							Function: schema.FunctionCall{
								Name:      sp.Name,
								Arguments: sp.Arguments,
							},
						})
					}
				}
			}
			msg := schema.AssistantMessage(m.Content, tcs)
			out = append(out, msg)
		case "tool":
			out = append(out, schema.ToolMessage(history.WireTool(m), m.ToolCallID))
		}
	}
	return out
}

func toolDeniedByMode(mode, name string) string {
	switch NormalizeChatMode(mode) {
	case ChatModeAsk:
		return "Ask 模式不能调用工具。请切到 Agent 执行，或 Plan 先出方案。"
	case ChatModePlan:
		if agentcap.RiskOf(name) != agentcap.RiskRead {
			return "Plan 模式只能只读探查。请把计划交给用户，或切到 Agent。"
		}
	}
	return ""
}

func schemaHasUserMedia(msgs []*schema.Message) bool {
	for _, m := range msgs {
		if m != nil && len(m.UserInputMultiContent) > 0 {
			return true
		}
	}
	return false
}

var _ guest.Guest = (*workbenchGuest)(nil)
