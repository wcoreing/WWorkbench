package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/workbenchtools"

	"github.com/google/uuid"
)

const maxAgentSteps = 10

// Emitter 向前端推送 Agent 事件。
type Emitter func(event string, payload map[string]interface{})

// threadState 对话线程状态。
type threadState struct {
	mu       sync.Mutex
	id       string
	title    string
	messages []chatMessage
	context  model.AgentContextDO
	updated  int64
}

// Runner Agent 编排器。
type Runner struct {
	store   *store.Store
	tools   *workbenchtools.Registry
	threads map[string]*threadState
	mu      sync.Mutex
	emit    Emitter
	appCtx  context.Context
	runs    map[string]context.CancelFunc
	runsMu  sync.Mutex
}

// NewRunner 创建 Runner。
func NewRunner(st *store.Store, reg *workbenchtools.Registry, appCtx context.Context, emit Emitter) *Runner {
	return &Runner{
		store:   st,
		tools:   reg,
		threads: map[string]*threadState{},
		emit:    emit,
		appCtx:  appCtx,
		runs:    map[string]context.CancelFunc{},
	}
}

// Stop 停止指定线程正在进行的生成。
func (r *Runner) Stop(threadID string) bool {
	if threadID == "" {
		return false
	}
	r.runsMu.Lock()
	cancel, ok := r.runs[threadID]
	r.runsMu.Unlock()
	if !ok {
		return false
	}
	cancel()
	return true
}

// Chat 处理用户消息（异步调用方应 go routine）。
func (r *Runner) Chat(req model.AgentChatRequestDO) (string, error) {
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		return "", fmt.Errorf("消息不能为空")
	}
	settings := r.store.GetAgentSettings()
	if !settings.HasAPIKey {
		return "", fmt.Errorf("请先在 AI 设置中填写 API Key 并保存")
	}
	if strings.TrimSpace(settings.Model) == "" {
		return "", fmt.Errorf("请先在 AI 设置中填写模型名称")
	}
	threadID := req.ThreadID
	if threadID == "" {
		threadID = uuid.NewString()
	}
	th := r.getOrCreateThread(threadID, req.Context, msg)
	userMsg := chatMessage{Role: "user", Content: strPtr(msg)}
	// 展示与持久化用原文；@ 资源通过 thread.context.mentions 在 runLoop 注入给模型
	th.mu.Lock()
	th.messages = append(th.messages, userMsg)
	th.mu.Unlock()
	r.persistMessage(threadID, userMsg)
	r.emit("agent:user", map[string]interface{}{
		"threadId": threadID, "content": msg, "mentions": req.Context.Mentions,
	})
	go r.runLoop(threadID)
	return threadID, nil
}

// Confirm 用户批准待确认操作并继续对话。
func (r *Runner) Confirm(pendingID string, approved bool) error {
	p, err := r.store.GetAgentPending(pendingID)
	if err != nil {
		return err
	}
	th := r.ensureThread(p.ThreadID)
	if th == nil {
		return fmt.Errorf("对话线程不存在")
	}
	_ = r.store.DeleteAgentPending(pendingID)
	if !approved {
		th.mu.Lock()
		rejectMsg := chatMessage{
			Role: "tool", ToolCallID: pendingID, Name: p.ToolName,
			Content: strPtr(`{"ok":false,"error":"用户已拒绝"}`),
		}
		th.messages = append(th.messages, rejectMsg)
		th.mu.Unlock()
		r.persistMessage(p.ThreadID, rejectMsg)
		go r.runLoop(p.ThreadID)
		return nil
	}
	var result workbenchtools.ToolResult
	if p.ToolName == "execute_sql" {
		result = workbenchtools.ExecuteSQLConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	} else {
		result = r.tools.Invoke(r.appCtx, p.ToolName, json.RawMessage(p.ArgsJSON), r.store.GetToolPermissions())
	}
	content, _ := json.Marshal(result)
	th.mu.Lock()
	toolMsg := chatMessage{
		Role: "tool", ToolCallID: pendingID, Name: p.ToolName, Content: strPtr(string(content)),
	}
	th.messages = append(th.messages, toolMsg)
	th.mu.Unlock()
	r.persistMessage(p.ThreadID, toolMsg)
	r.emit("agent:tool_end", map[string]interface{}{
		"threadId": p.ThreadID, "tool": p.ToolName, "result": result,
	})
	go r.runLoop(p.ThreadID)
	return nil
}

// TestConnection 测试 LLM 连接（简单问答，不调用工具）。
func (r *Runner) TestConnection() (string, error) {
	settings := r.store.GetAgentSettings()
	if !settings.HasAPIKey {
		return "", fmt.Errorf("请先保存 API Key")
	}
	provider := NewProvider(settings.APIBase, r.store.AgentAPIKey(), settings.Model)
	ctx, cancel := context.WithTimeout(r.appCtx, 60*time.Second)
	defer cancel()
	reply, err := provider.Complete(ctx, []chatMessage{
		{Role: "user", Content: strPtr("回复 OK 两个字母即可")},
	}, nil)
	if err != nil {
		return "", err
	}
	text := contentString(reply.Content)
	if text == "" {
		return "连接成功（模型未返回文本）", nil
	}
	return "连接成功: " + strings.TrimSpace(text), nil
}

// ListMessages 列出线程消息（用于 UI）。
func (r *Runner) ListMessages(threadID string) []model.AgentMessageDO {
	th := r.getThread(threadID)
	if th == nil {
		return nil
	}
	th.mu.Lock()
	defer th.mu.Unlock()
	out := make([]model.AgentMessageDO, 0, len(th.messages))
	for _, m := range th.messages {
		if m.Role == "tool" || m.Role == "system" {
			continue
		}
		out = append(out, model.AgentMessageDO{Role: m.Role, Content: displayContent(m)})
	}
	return out
}

func contentString(c *string) string {
	if c == nil {
		return ""
	}
	return *c
}

func displayContent(m chatMessage) string {
	if s := contentString(m.Content); s != "" {
		return s
	}
	if len(m.ToolCalls) > 0 {
		var names []string
		for _, tc := range m.ToolCalls {
			names = append(names, tc.Function.Name)
		}
		return "调用工具: " + strings.Join(names, ", ")
	}
	return ""
}

func (r *Runner) getOrCreateThread(id string, ctx model.AgentContextDO, firstMsg string) *threadState {
	if th := r.ensureThread(id); th != nil {
		th.mu.Lock()
		th.context = ctx
		th.mu.Unlock()
		return th
	}
	title := firstMsg
	if len([]rune(title)) > 24 {
		title = string([]rune(title)[:24]) + "…"
	}
	sys := chatMessage{Role: "system", Content: strPtr(systemPrompt())}
	th := &threadState{
		id: id, title: title, context: ctx, updated: time.Now().Unix(),
		messages: []chatMessage{sys},
	}
	r.mu.Lock()
	r.threads[id] = th
	r.mu.Unlock()
	ctxJSON, _ := json.Marshal(ctx)
	_ = r.store.SaveAgentThread(model.AgentThreadDO{ID: id, Title: title, UpdatedAt: time.Now().Unix()}, string(ctxJSON))
	r.persistMessage(id, sys)
	return th
}

func (r *Runner) getThread(id string) *threadState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.threads[id]
}

// ensureThread 从内存或数据库加载线程。
func (r *Runner) ensureThread(id string) *threadState {
	if th := r.getThread(id); th != nil {
		return th
	}
	if th := r.loadThreadFromStore(id); th != nil {
		r.mu.Lock()
		r.threads[id] = th
		r.mu.Unlock()
		return th
	}
	return nil
}

// loadThreadFromStore 从 SQLite 恢复线程。
func (r *Runner) loadThreadFromStore(id string) *threadState {
	meta, ctxJSON, err := r.store.GetAgentThread(id)
	if err != nil {
		return nil
	}
	payloads, err := r.store.ListAgentMessagePayloads(id)
	if err != nil {
		return nil
	}
	msgs := make([]chatMessage, 0, len(payloads))
	for _, raw := range payloads {
		var m chatMessage
		if json.Unmarshal(raw, &m) == nil {
			msgs = append(msgs, m)
		}
	}
	if len(msgs) == 0 {
		msgs = []chatMessage{{Role: "system", Content: strPtr(systemPrompt())}}
	}
	var ctx model.AgentContextDO
	_ = json.Unmarshal([]byte(ctxJSON), &ctx)
	return &threadState{
		id: meta.ID, title: meta.Title, context: ctx, updated: meta.UpdatedAt, messages: msgs,
	}
}

// persistMessage 将消息写入本地库。
func (r *Runner) persistMessage(threadID string, m chatMessage) {
	payload, err := json.Marshal(m)
	if err != nil {
		return
	}
	disp := displayContent(m)
	if m.Role == "tool" && disp == "" {
		disp = "tool:" + m.Name
	}
	_ = r.store.AppendAgentMessage(threadID, m.Role, disp, string(payload))
}

func (r *Runner) runLoop(threadID string) {
	defer func() {
		if rec := recover(); rec != nil {
			r.emit("agent:done", map[string]interface{}{
				"threadId": threadID,
				"error":    fmt.Sprintf("AI 内部错误: %v", rec),
			})
		}
	}()
	th := r.getThread(threadID)
	if th == nil {
		return
	}
	settings := r.store.GetAgentSettings()
	provider := NewProvider(settings.APIBase, r.store.AgentAPIKey(), settings.Model)
	ctx, cancel := context.WithTimeout(r.appCtx, 180*time.Second)
	r.runsMu.Lock()
	if old, ok := r.runs[threadID]; ok {
		old()
	}
	r.runs[threadID] = cancel
	r.runsMu.Unlock()
	defer func() {
		r.runsMu.Lock()
		delete(r.runs, threadID)
		r.runsMu.Unlock()
		cancel()
	}()

	for step := 0; step < maxAgentSteps; step++ {
		if ctx.Err() != nil {
			r.emit("agent:done", map[string]interface{}{"threadId": threadID, "stopped": true})
			return
		}
		th.mu.Lock()
		msgs := injectMentionHints(append([]chatMessage(nil), th.messages...), th.context.Mentions)
		ctxSnap := th.context
		th.mu.Unlock()

		perms := r.store.GetToolPermissions()
		toolDefs := r.tools.ListDefsFiltered(perms)
		assistant, err := provider.CompleteStream(ctx, msgs, toolDefs, func(delta string) {
			if delta != "" {
				r.emit("agent:assistant_delta", map[string]interface{}{
					"threadId": threadID, "delta": delta,
				})
			}
		})
		if err != nil {
			if ctx.Err() != nil {
				r.emit("agent:done", map[string]interface{}{"threadId": threadID, "stopped": true})
				return
			}
			r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
			return
		}
		th.mu.Lock()
		th.messages = append(th.messages, assistant)
		th.mu.Unlock()
		r.persistMessage(threadID, assistant)

		if len(assistant.ToolCalls) == 0 {
			if text := contentString(assistant.Content); text != "" {
				r.emit("agent:assistant", map[string]interface{}{
					"threadId": threadID, "content": text,
				})
			}
			r.emit("agent:done", map[string]interface{}{"threadId": threadID})
			return
		}

		for _, tc := range assistant.ToolCalls {
			callID := tc.ID
			if callID == "" {
				callID = uuid.NewString()
			}
			name := tc.Function.Name
			if name == "" {
				continue
			}
			args := json.RawMessage(tc.Function.Arguments)
			if len(args) == 0 {
				args = json.RawMessage("{}")
			}
			if name == "get_workbench_context" {
				var merged map[string]interface{}
				_ = json.Unmarshal(args, &merged)
				if merged == nil {
					merged = map[string]interface{}{}
				}
				merged["activeProduct"] = ctxSnap.ActiveProduct
				merged["sessionId"] = ctxSnap.SessionID
				merged["connectionId"] = ctxSnap.ConnectionID
				merged["database"] = ctxSnap.Database
				if len(ctxSnap.Mentions) > 0 {
					merged["mentions"] = ctxSnap.Mentions
				}
				args, _ = json.Marshal(merged)
			}
			r.emit("agent:tool_start", map[string]interface{}{
				"threadId": threadID, "tool": name, "args": string(args),
			})
			result := r.tools.Invoke(ctx, name, args, perms)
			if result.NeedsConfirm {
				_ = r.store.SaveAgentPending(model.AgentPendingDO{
					ID: callID, ThreadID: threadID, ToolName: name,
					ArgsJSON: string(args), Summary: result.ConfirmSummary,
				})
				r.emit("agent:needs_confirm", map[string]interface{}{
					"threadId": threadID, "pendingId": callID, "tool": name,
					"summary": result.ConfirmSummary, "preview": json.RawMessage(result.Data),
				})
				r.emit("agent:done", map[string]interface{}{"threadId": threadID, "waitingConfirm": true})
				return
			}
			content, _ := json.Marshal(result)
			th.mu.Lock()
			toolMsg := chatMessage{
				Role: "tool", ToolCallID: callID, Name: name, Content: strPtr(string(content)),
			}
			th.messages = append(th.messages, toolMsg)
			th.mu.Unlock()
			r.persistMessage(threadID, toolMsg)
			r.emit("agent:tool_end", map[string]interface{}{
				"threadId": threadID, "tool": name, "result": result,
			})
		}
	}
	r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "已达到最大工具调用步数"})
}

// injectMentionHints 将 @ 选中的资源附加到最近一条用户消息供模型使用。
func injectMentionHints(msgs []chatMessage, mentions []model.AgentMentionDO) []chatMessage {
	if len(mentions) == 0 {
		return msgs
	}
	out := append([]chatMessage(nil), msgs...)
	for i := len(out) - 1; i >= 0; i-- {
		if out[i].Role != "user" {
			continue
		}
		base := contentString(out[i].Content)
		out[i] = chatMessage{Role: "user", Content: strPtr(base + formatMentionsSuffix(mentions))}
		break
	}
	return out
}

// formatMentionsSuffix 生成 @ 资源说明后缀。
func formatMentionsSuffix(mentions []model.AgentMentionDO) string {
	if len(mentions) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n[用户通过 @ 指定的资源（优先使用以下 ID，勿编造）]\n")
	for _, m := range mentions {
		switch m.Kind {
		case "ssh":
			b.WriteString(fmt.Sprintf("- SSH「%s」 hostId=%s\n", m.Label, m.ID))
		case "database":
			b.WriteString(fmt.Sprintf("- 数据库「%s」 connectionId=%s\n", m.Label, m.ID))
		default:
			b.WriteString(fmt.Sprintf("- %s id=%s\n", m.Label, m.ID))
		}
	}
	return b.String()
}

func systemPrompt() string {
	return `你是 WWorkbench 内置助手，只能通过提供的工具操作工作台。
规则：
1. 用户问「有哪些连接/链接」时，必须同时调用 list_connections（数据库）与 list_ssh_hosts（SSH），分开展示，不要遗漏 SSH。
2. 查看远程资源：优先 terminal.exec（command 如 uptime、free -h、df -h）拿到输出再总结；若需用户自己看交互式输出，用 terminal.open 打开终端并注入 initialCommand。
3. 要在数据库工作台查数据：可用 database.open 打开连接并填 SQL，或 open_database_session + execute_sql。
4. 操作数据库前先 list_connections 或 get_workbench_context，不要编造 connectionId 与 sessionId。用户消息末尾若含 @ 指定资源，必须优先使用其中的 hostId / connectionId。
5. 默认 execute_sql 使用 readonly=true；仅当用户明确要求修改数据时才 readonly=false（需用户确认）。
6. 禁止执行 DROP DATABASE 等危险操作。
7. 不要输出或猜测密码。回复使用简体中文，可用 Markdown 表格与列表。
8. 需要图表时用独立代码块：围栏语言为 echarts，内容为合法 ECharts option JSON（折线、柱状、饼图等）。` +
		"\n   示例围栏：\n```echarts\n{\"title\":{\"text\":\"示例\"},\"xAxis\":{\"type\":\"category\",\"data\":[\"A\",\"B\"]},\"yAxis\":{\"type\":\"value\"},\"series\":[{\"type\":\"bar\",\"data\":[3,5]}]}\n```"
}
