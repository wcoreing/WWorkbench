package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/brain"
	"WWorkbench/internal/harness"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbenchtools"

	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/history"
)

// ensureCursorBrain 懒创建 Cursor External。
func (r *Runner) ensureCursorBrain(dataDir, apiKey string) *brain.CursorBrain {
	r.brainMu.Lock()
	defer r.brainMu.Unlock()
	if r.cursorBrain != nil {
		r.cursorBrain.SetAPIKey(apiKey)
		return r.cursorBrain
	}
	r.cursorBrain = brain.NewCursorBrain(dataDir, apiKey, r.store)
	return r.cursorBrain
}

func (r *Runner) toolSurface() *brain.ToolSurface {
	r.brainMu.Lock()
	defer r.brainMu.Unlock()
	if r.surface != nil {
		return r.surface
	}
	r.surface = brain.NewToolSurface(r.tools, r.harness, func(ctx context.Context, name, argsJSON string) workbenchtools.ToolResult {
		return r.executeConfirmed(ctx, name, argsJSON)
	})
	return r.surface
}

// runExternalBrainTurn 经 ningharness Lifecycle（think=external）跑外置大脑，不再旁路。
func (r *Runner) runExternalBrainTurn(ctx context.Context, kind string, threadID, prompt, feedforward string, skipUser bool, mode string) {
	if r.harness == nil || r.harness.RT == nil {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "harness 未就绪"})
		return
	}
	settings := r.store.GetAgentSettings()
	apiKey := r.store.AgentAPIKey()
	dataDir, err := store.DataDir()
	if err != nil {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
		return
	}

	var br guest.External
	switch kind {
	case brain.KindCursor:
		br = r.ensureCursorBrain(dataDir, apiKey)
	default:
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "未知外置大脑: " + kind})
		return
	}

	taskID := fmt.Sprintf("chat:%d", time.Now().UnixMilli())
	th := r.ensureThread(threadID)
	if th != nil {
		th.mu.Lock()
		th.taskID = taskID
		th.mu.Unlock()
	}

	surface := r.toolSurface()
	callerCtx := workbenchtools.WithCaller(ctx, workbenchtools.CallerAgent(threadID))

	var histMu sync.Mutex
	var histBuf []cursorHistTool
	argsByCall := map[string]string{}

	emit := func(ev guest.Event) {
		switch ev.Kind {
		case guest.EventTextDelta:
			if ev.Text != "" {
				r.emit("agent:assistant_delta", map[string]interface{}{
					"threadId": threadID, "delta": ev.Text,
				})
			}
		case guest.EventProgress:
			r.emit("agent:tool_start", map[string]interface{}{
				"threadId": threadID, "tool": firstNonEmpty(ev.Tool, "external_brain"), "args": firstNonEmpty(ev.Args, ev.Text),
			})
		case guest.EventToolStart:
			if ev.CallID != "" {
				histMu.Lock()
				argsByCall[ev.CallID] = ev.Args
				histMu.Unlock()
			}
			r.emit("agent:tool_start", map[string]interface{}{
				"threadId": threadID, "tool": ev.Tool, "args": ev.Args, "callId": ev.CallID, "taskId": taskID,
			})
		case guest.EventToolEnd:
			end := map[string]interface{}{
				"threadId": threadID, "tool": ev.Tool, "callId": ev.CallID,
				"status": mapBrainStatus(ev.Status), "summary": ev.Summary,
			}
			if ev.ResourceID > 0 {
				end["resourceId"] = ev.ResourceID
			}
			var result workbenchtools.ToolResult
			if len(ev.ResultJSON) > 0 {
				_ = json.Unmarshal(ev.ResultJSON, &result)
				end["result"] = result
				histMu.Lock()
				args := argsByCall[ev.CallID]
				delete(argsByCall, ev.CallID)
				histBuf = append(histBuf, cursorHistTool{
					ID: ev.CallID, Name: ev.Tool, Args: args, Result: result, RID: ev.ResourceID,
				})
				histMu.Unlock()
			}
			r.emit("agent:tool_end", end)
		case guest.EventError:
			r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": ev.Text})
		}
	}

	rt := r.harness.RT
	rt.SetExternal(br)
	rt.SetTools(surface)
	rt.OnExternalEvent = emit
	defer func() {
		rt.OnExternalEvent = nil
	}()

	st, runErr := r.harness.RunTurn(callerCtx, harness.TurnInput{
		SessionKey:           threadID,
		Prompt:               prompt,
		Feedforward:          feedforward,
		SkipUserAppend:       skipUser,
		TaskID:               taskID,
		Think:                guest.ThinkExternal,
		ExternalMode:         mode,
		ExternalAPIKey:       apiKey,
		ExternalModel:        settings.Model,
		ExternalSystemPrompt: r.systemPrompt(mode),
	})

	root := r.harness.Root
	histMu.Lock()
	buf := histBuf
	histMu.Unlock()
	final := ""
	if st != nil {
		final = strings.TrimSpace(st.Reply)
	}
	// 外置：Lifecycle 不落 assistant 正文，由此处按 tool_calls → tools → 正文 顺序落盘。
	r.persistExternalTurn(root, threadID, taskID, final, buf)
	if runErr != nil {
		r.emitTurnDone(threadID, ctx, runErr)
		return
	}
	r.recordTurnThought(threadID)
	r.emitTurnDone(threadID, ctx, nil)
}

func (r *Runner) persistExternalTurn(root, threadID, taskID, final string, buf []cursorHistTool) {
	if root == "" {
		if final != "" {
			r.emit("agent:assistant", map[string]interface{}{
				"threadId": threadID, "content": final,
			})
		}
		return
	}
	if len(buf) > 0 {
		specs := make([]history.ToolCallSpec, 0, len(buf))
		for _, t := range buf {
			specs = append(specs, history.ToolCallSpec{
				ID: t.ID, Name: t.Name, Arguments: t.Args,
			})
		}
		_ = history.Append(root, threadID, history.Msg{
			Role: "assistant", Content: "",
			ToolCallsJSON: history.EncodeToolCalls(specs), TaskID: taskID,
		})
		for _, t := range buf {
			content := formatToolMessage(t.Result, t.RID)
			ids := ""
			if t.RID > 0 {
				ids = history.EncodeResourceIDs([]int64{t.RID})
			}
			_ = history.Append(root, threadID, history.Msg{
				Role: "tool", ToolCallID: t.ID, TaskID: taskID,
				Content: content, ResourceIDsJSON: ids,
			})
		}
	}
	if final == "" {
		return
	}
	_ = history.Append(root, threadID, history.Msg{
		Role: "assistant", Content: final, TaskID: taskID,
	})
	r.emit("agent:assistant", map[string]interface{}{
		"threadId": threadID, "content": final,
	})
}

func mapBrainStatus(s string) string {
	switch s {
	case "ok":
		return StatusOK
	case "error":
		return StatusError
	case "need_confirm":
		return StatusNeedConfirm
	case "need_choice":
		return StatusNeedChoice
	default:
		if s == "" {
			return StatusOK
		}
		return s
	}
}

func (r *Runner) closeExternalBrains() {
	r.brainMu.Lock()
	cb := r.cursorBrain
	r.cursorBrain = nil
	r.surface = nil
	r.brainMu.Unlock()
	if r.harness != nil && r.harness.RT != nil {
		r.harness.RT.SetExternal(nil)
		r.harness.RT.SetTools(nil)
		r.harness.RT.OnExternalEvent = nil
	}
	if cb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cb.Close(ctx)
	}
}
