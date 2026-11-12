package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/cursorbridge"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbenchtools"

	"github.com/google/uuid"
	"github.com/wcoreing/ningharness/history"
)

// runCursorTurn 经 Cursor SDK Bridge 跑一轮（真驱动，非 OpenAI 兼容壳）。
func (r *Runner) runCursorTurn(ctx context.Context, threadID, prompt, feedforward string, skipUser bool, mode string) {
	r.cursorMu.Lock()
	r.cursorTurnCtx = ctx
	r.cursorMu.Unlock()
	defer func() {
		r.cursorMu.Lock()
		r.cursorTurnCtx = nil
		r.cursorMu.Unlock()
	}()
	workbenchtools.MarkAgentRulesAck()

	settings := r.store.GetAgentSettings()
	apiKey := r.store.AgentAPIKey()
	if strings.TrimSpace(apiKey) == "" {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "请先填写 CURSOR_API_KEY"})
		return
	}
	dataDir, err := store.DataDir()
	if err != nil {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
		return
	}

	sess := r.ensureCursorSession(dataDir, apiKey)
	warm := sess.Ready()
	var progress cursorbridge.ProgressFn
	if !warm {
		progress = func(stage, detail string) {
			_ = stage
			r.emit("agent:tool_start", map[string]interface{}{
				"threadId": threadID, "tool": "cursor_bridge", "args": detail,
			})
		}
		progress("ensure", "正在准备 Cursor SDK Bridge…")
	}
	cli, err := sess.Ensure(ctx, progress)
	if err != nil {
		if !warm {
			r.emit("agent:tool_end", map[string]interface{}{
				"threadId": threadID, "tool": "cursor_bridge",
				"status": StatusError, "summary": err.Error(),
			})
		}
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
		return
	}
	if !warm {
		r.emit("agent:tool_end", map[string]interface{}{
			"threadId": threadID, "tool": "cursor_bridge",
			"status": StatusOK, "summary": "Bridge 已就绪（本进程内将复用）",
		})
	}

	root := ""
	if r.harness != nil {
		root = r.harness.Root
		_ = history.EnsureSystem(root, threadID, r.systemPrompt(mode))
	}

	taskID := fmt.Sprintf("chat:%d", time.Now().UnixMilli())
	th := r.ensureThread(threadID)
	if th != nil {
		th.mu.Lock()
		th.taskID = taskID
		th.mu.Unlock()
	}

	if !skipUser && root != "" {
		_ = history.Append(root, threadID, history.Msg{
			Role: "user", Content: prompt, TaskID: taskID,
		})
	}

	modelName := settings.Model
	opts := cursorbridge.CreateAgentOpts{
		APIKey:      apiKey,
		Model:       modelName,
		CWD:         sess.Workspace(),
		Mode:        mapCursorMode(mode),
		CustomTools: r.cursorCustomTools(mode),
	}
	agentID := r.loadCursorAgentID(threadID)
	if agentID != "" {
		if _, err := cli.ResumeAgent(ctx, agentID, opts); err != nil {
			agentID = ""
		}
	}
	if agentID == "" {
		agentID, err = cli.CreateAgent(ctx, opts)
		if err != nil {
			// 无回调时 customTools 会失败；降级为无工作台工具仍可对话
			if len(opts.CustomTools) > 0 {
				opts.CustomTools = nil
				agentID, err = cli.CreateAgent(ctx, opts)
			}
			if err != nil {
				r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "CreateAgent: " + err.Error()})
				return
			}
			r.emit("agent:tool_end", map[string]interface{}{
				"threadId": threadID, "tool": "cursor_bridge",
				"status": StatusOK, "summary": "已创建 Agent（工作台工具未挂载，请重启 App）",
			})
		}
		r.saveCursorAgentID(threadID, agentID)
	}

	// 上一轮卡在待确认/未取消时会报 already has active run
	if n, _ := cli.CancelActiveRuns(ctx, agentID, apiKey); n > 0 {
		r.emit("agent:tool_start", map[string]interface{}{
			"threadId": threadID, "tool": "cursor_bridge", "args": fmt.Sprintf("已取消 %d 个未结束的 Cursor run", n),
		})
		r.emit("agent:tool_end", map[string]interface{}{
			"threadId": threadID, "tool": "cursor_bridge",
			"status": StatusOK, "summary": "已清理卡住的 run",
		})
	}
	// ResumeAgent 不一定带齐本地 UI 可见历史；短回复（如「1」）必须灌近轮摘录，否则模型看不到选项编号。
	recent := cursorRecentDialog(root, threadID)
	msg := buildCursorUserMessage(prompt, feedforward, mode, recent)

	r.clearCursorTurnBuf()
	final, sendErr := r.cursorSend(ctx, cli, agentID, apiKey, opts, threadID, taskID, msg)
	// 先落盘工具+正文再 done，重开线程才能看到轨迹
	r.persistCursorTurn(root, threadID, taskID, final)
	if sendErr != nil {
		r.emitTurnDone(threadID, ctx, sendErr)
		return
	}
	r.recordTurnThought(threadID)
	r.emitTurnDone(threadID, ctx, nil)
}

func (r *Runner) clearCursorTurnBuf() {
	r.cursorMu.Lock()
	r.cursorTurnBuf = nil
	r.cursorMu.Unlock()
}

func (r *Runner) pushCursorHistTool(t cursorHistTool) {
	r.cursorMu.Lock()
	r.cursorTurnBuf = append(r.cursorTurnBuf, t)
	r.cursorMu.Unlock()
}

// persistCursorTurn 按 guest 顺序落盘：assistant(tool_calls) → tool* → assistant(正文)。
func (r *Runner) persistCursorTurn(root, threadID, taskID, final string) {
	r.cursorMu.Lock()
	buf := r.cursorTurnBuf
	r.cursorTurnBuf = nil
	r.cursorMu.Unlock()

	if root == "" {
		if strings.TrimSpace(final) != "" {
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

	if strings.TrimSpace(final) == "" {
		return
	}
	_ = history.Append(root, threadID, history.Msg{
		Role: "assistant", Content: final, TaskID: taskID,
	})
	r.emit("agent:assistant", map[string]interface{}{
		"threadId": threadID, "content": final,
	})
}

// cursorSend 发送一轮；遇 active run 则取消重试，仍失败则新建 Agent。
func (r *Runner) cursorSend(
	ctx context.Context,
	cli *cursorbridge.Client,
	agentID, apiKey string,
	opts cursorbridge.CreateAgentOpts,
	threadID, taskID, msg string,
) (final string, err error) {
	onEv := func(ev cursorbridge.SendEvent) {
		switch ev.Kind {
		case "assistant_delta", "assistant":
			if ev.Text != "" {
				r.emit("agent:assistant_delta", map[string]interface{}{
					"threadId": threadID, "delta": ev.Text,
				})
			}
		case "tool_call":
			// Cursor 流里的 tool_call 多为 mcp 协议壳：只有类型名、无 args、也无配对 end。
			// 真实工作台工具由 handleCursorTool 发 start/end，这里不再造空行。
		}
	}
	final, _, err = cli.Send(ctx, agentID, msg, onEv)
	if err == nil || !strings.Contains(err.Error(), "already has active run") {
		return final, err
	}
	_, _ = cli.CancelActiveRuns(ctx, agentID, apiKey)
	final, _, err = cli.Send(ctx, agentID, msg, onEv)
	if err == nil || !strings.Contains(err.Error(), "already has active run") {
		return final, err
	}
	// 旧 Agent 僵死：换新的
	r.saveCursorAgentID(threadID, "")
	newID, cerr := cli.CreateAgent(ctx, opts)
	if cerr != nil {
		return "", fmt.Errorf("%v；重建 Agent 失败: %w", err, cerr)
	}
	r.saveCursorAgentID(threadID, newID)
	final, _, err = cli.Send(ctx, newID, msg, onEv)
	return final, err
}

func (r *Runner) ensureCursorSession(dataDir, apiKey string) *cursorbridge.Session {
	r.cursorMu.Lock()
	defer r.cursorMu.Unlock()
	if r.cursorSess != nil {
		r.cursorSess.SetAPIKey(apiKey)
		return r.cursorSess
	}
	r.cursorSess = cursorbridge.NewSession(dataDir, apiKey, r.handleCursorTool)
	return r.cursorSess
}

func (r *Runner) handleCursorTool(httpCtx context.Context, toolName string, args json.RawMessage, toolCallID, agentID string) (map[string]interface{}, error) {
	_ = agentID
	_ = httpCtx // 工具执行必须脱离回调 HTTP ctx，否则 Cursor 掐回调会取消 SQL 并拖死整轮 Send
	if r.harness == nil {
		return map[string]interface{}{"ok": false, "error": "harness 未就绪"}, nil
	}
	name := strings.TrimSpace(toolName)
	callID := strings.TrimSpace(toolCallID)
	if callID == "" {
		callID = uuid.NewString()
	}
	r.cursorMu.Lock()
	threadID := r.cursorActiveThread
	execCtx := r.cursorTurnCtx
	r.cursorMu.Unlock()
	if execCtx == nil {
		execCtx = context.Background()
	}
	argsStr := string(args)
	if strings.TrimSpace(argsStr) == "" {
		argsStr = "{}"
	}
	taskID := ""
	if th := r.ensureThread(threadID); th != nil {
		th.mu.Lock()
		taskID = th.taskID
		th.mu.Unlock()
	}
	_, _, _ = r.harness.PutToolCall(threadID, taskID, callID, name, argsStr)
	r.emit("agent:tool_start", map[string]interface{}{
		"threadId": threadID, "tool": name, "args": argsStr, "callId": callID, "taskId": taskID,
	})
	result := r.harness.CallTool(execCtx, name, args)
	// 写工具自动走 Confirmed 路径（无侧栏确认）。
	if result.NeedsConfirm {
		result = r.executeConfirmed(name, argsStr)
	}
	body, _ := json.Marshal(result)
	rid, _, _ := r.harness.PutToolResult(threadID, taskID, callID, name, string(body))
	status, summary := toolStatus(name, result)
	if rid > 0 {
		summary = fmt.Sprintf("%s · #%d", summary, rid)
	}
	end := map[string]interface{}{
		"threadId": threadID, "tool": name, "callId": callID,
		"status": status, "summary": summary, "result": result,
	}
	if rid > 0 {
		end["resourceId"] = rid
	}
	r.emit("agent:tool_end", end)
	r.pushCursorHistTool(cursorHistTool{
		ID: callID, Name: name, Args: argsStr, Result: result, RID: rid,
	})
	var asMap map[string]interface{}
	if err := json.Unmarshal(body, &asMap); err != nil {
		return map[string]interface{}{"ok": result.OK, "summary": summary, "raw": string(body)}, nil
	}
	return asMap, nil
}

func (r *Runner) cursorCustomTools(mode string) map[string]cursorbridge.CustomTool {
	perms := r.tools.Deps().EffectivePermissions()
	defs := r.listToolDefs(perms, mode)
	out := make(map[string]cursorbridge.CustomTool, len(defs))
	for _, d := range defs {
		schema := d.Parameters
		if schema == nil {
			schema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		out[d.Name] = cursorbridge.CustomTool{
			Description: d.Description,
			InputSchema: schema,
		}
	}
	return out
}

func (r *Runner) loadCursorAgentID(threadID string) string {
	v, _ := r.store.GetAppSetting(cursorAgentKey(threadID))
	return strings.TrimSpace(v)
}

func (r *Runner) saveCursorAgentID(threadID, agentID string) {
	_ = r.store.SetAppSetting(cursorAgentKey(threadID), agentID)
}

func cursorAgentKey(threadID string) string {
	return "cursor_agent_" + strings.TrimSpace(threadID)
}

func mapCursorMode(mode string) string {
	if NormalizeChatMode(mode) == ChatModePlan {
		return "plan"
	}
	return "agent"
}

func buildCursorUserMessage(prompt, feedforward, mode, recentDialog string) string {
	var b strings.Builder
	b.WriteString("你在 WWorkbench 桌面工作台中运行。数据库/SSH/插件等能力以自定义工具提供")
	b.WriteString("（如 list_connections、execute_sql、read_plugin_pack_file、edit_plugin_pack_file）；")
	b.WriteString("需要时请调用工具，不要假装已执行。对用户用简体中文。\n")
	b.WriteString("界面快照只描述 UI，不取代对话历史；用户只回数字时按历史里上一轮助手编号选项执行。拍板优先 offer_choices。\n")
	if mode != "" {
		b.WriteString("当前模式: ")
		b.WriteString(mode)
		b.WriteByte('\n')
	}
	// 用户原话优先，再补近轮与界面快照（Cursor 单轮消息，顺序影响注意力）
	b.WriteString("\n【用户】\n")
	b.WriteString(prompt)
	if strings.TrimSpace(recentDialog) != "" {
		b.WriteString("\n\n")
		b.WriteString(recentDialog)
	}
	if strings.TrimSpace(feedforward) != "" {
		b.WriteString("\n\n")
		b.WriteString(feedforward)
	}
	return b.String()
}

// cursorRecentDialog 从本地 history 摘近轮 user/assistant 正文，供 Cursor 单轮消息补上下文。
// 跳过本轮刚 Append 的最后一条 user（即当前 prompt），避免重复。
func cursorRecentDialog(root, threadID string) string {
	if strings.TrimSpace(root) == "" || strings.TrimSpace(threadID) == "" {
		return ""
	}
	all, err := history.Load(root, threadID)
	if err != nil || len(all) == 0 {
		return ""
	}
	type turn struct{ role, text string }
	var picks []turn
	skipLastUser := true
	for i := len(all) - 1; i >= 0 && len(picks) < 6; i-- {
		m := all[i]
		switch m.Role {
		case "user", "assistant":
			text := strings.TrimSpace(history.ContentForUI(m.Content))
			if text == "" {
				continue
			}
			if skipLastUser && m.Role == "user" {
				skipLastUser = false
				continue
			}
			skipLastUser = false
			if len(text) > 1200 {
				text = text[:1200] + "…"
			}
			label := "助手"
			if m.Role == "user" {
				label = "用户"
			}
			picks = append(picks, turn{label, text})
		}
	}
	if len(picks) == 0 {
		return ""
	}
	// picks 是从新到旧，输出改为旧→新
	var b strings.Builder
	b.WriteString("【近轮对话】（Cursor 会话外本地历史，与界面快照无关）\n")
	total := 0
	for i := len(picks) - 1; i >= 0; i-- {
		line := picks[i].role + "：" + picks[i].text + "\n"
		if total+len(line) > 4000 {
			break
		}
		b.WriteString(line)
		total += len(line)
	}
	return strings.TrimSpace(b.String())
}

func stringFromMap(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if ok {
		return s
	}
	return fmt.Sprint(v)
}

func (r *Runner) closeCursorSession() {
	r.cursorMu.Lock()
	sess := r.cursorSess
	r.cursorSess = nil
	r.cursorMu.Unlock()
	if sess != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		sess.Close(ctx)
	}
}

// TestCursorConnection 经 Bridge Ping + Me。
func (r *Runner) TestCursorConnection(ctx context.Context) (string, error) {
	apiKey := r.store.AgentAPIKey()
	if apiKey == "" {
		return "", fmt.Errorf("请先保存 CURSOR_API_KEY")
	}
	dataDir, err := store.DataDir()
	if err != nil {
		return "", err
	}
	sess := r.ensureCursorSession(dataDir, apiKey)
	cli, err := sess.Ensure(ctx, nil)
	if err != nil {
		return "", err
	}
	if err := cli.Ping(ctx); err != nil {
		return "", fmt.Errorf("Ping: %w", err)
	}
	who, err := cli.Me(ctx, apiKey)
	if err != nil {
		return "", fmt.Errorf("Me: %w", err)
	}
	return "Cursor Bridge 连接成功: " + who + " · " + filepath.Base(sess.Workspace()), nil
}
