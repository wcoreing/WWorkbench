package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"WWorkbench/internal/cursorbridge"

	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/history"
)

// AgentIDStore Cursor agentId 持久化（按 thread）。
type AgentIDStore interface {
	GetAppSetting(key string) (string, error)
	SetAppSetting(key, value string) error
}

// CursorBrain 实现 guest.External（产品适配器；契约在 ningharness）。
type CursorBrain struct {
	mu      sync.Mutex
	dataDir string
	apiKey  string
	ids     AgentIDStore
	sess    *cursorbridge.Session

	tools guest.Tools
	emit  guest.Emit
	mode  string
}

// NewCursorBrain 创建 Cursor 外置大脑（未 Ensure）。
func NewCursorBrain(dataDir, apiKey string, ids AgentIDStore) *CursorBrain {
	b := &CursorBrain{dataDir: dataDir, apiKey: apiKey, ids: ids}
	b.sess = cursorbridge.NewSession(dataDir, apiKey, b.onTool)
	return b
}

var _ guest.External = (*CursorBrain)(nil)

func (b *CursorBrain) Kind() string { return KindCursor }

// SetAPIKey 热更新密钥。
func (b *CursorBrain) SetAPIKey(key string) {
	b.mu.Lock()
	b.apiKey = key
	if b.sess != nil {
		b.sess.SetAPIKey(key)
	}
	b.mu.Unlock()
}

func (b *CursorBrain) Ensure(ctx context.Context, onProgress func(stage, detail string)) error {
	b.mu.Lock()
	sess := b.sess
	b.mu.Unlock()
	if sess == nil {
		return fmt.Errorf("cursor brain: no session")
	}
	_, err := sess.Ensure(ctx, onProgress)
	return err
}

func (b *CursorBrain) Ready() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sess != nil && b.sess.Ready()
}

func (b *CursorBrain) Workspace() string {
	return filepath.Join(b.dataDir, "cursor-workspace")
}

func (b *CursorBrain) Close(ctx context.Context) {
	b.mu.Lock()
	sess := b.sess
	b.sess = nil
	b.mu.Unlock()
	if sess != nil {
		sess.Close(ctx)
	}
}

func (b *CursorBrain) Abort(ctx context.Context, sessionKey string) error {
	apiKey := strings.TrimSpace(b.apiKey)
	agentID := b.loadAgentID(sessionKey)
	if apiKey == "" || agentID == "" {
		return nil
	}
	if err := b.Ensure(ctx, nil); err != nil {
		return err
	}
	b.mu.Lock()
	sess := b.sess
	b.mu.Unlock()
	cli, err := sess.Ensure(ctx, nil)
	if err != nil {
		return err
	}
	_, _ = cli.CancelActiveRuns(ctx, agentID, apiKey)
	return nil
}

func (b *CursorBrain) RunTurn(ctx context.Context, in guest.ExternalTurn, tools guest.Tools, emit guest.Emit) (string, error) {
	if tools == nil {
		return "", fmt.Errorf("cursor brain: nil tools")
	}
	if emit == nil {
		emit = func(guest.Event) {}
	}
	apiKey := strings.TrimSpace(in.APIKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(b.apiKey)
	}
	if apiKey == "" {
		return "", fmt.Errorf("请先填写 CURSOR_API_KEY")
	}
	b.SetAPIKey(apiKey)

	b.mu.Lock()
	b.tools = tools
	b.emit = emit
	b.mode = in.Mode
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		b.tools = nil
		b.emit = nil
		b.mu.Unlock()
		tools.ClearTurn()
	}()

	tools.BindTurn(in.SessionKey, in.TaskID, ctx)

	warm := b.Ready()
	var progress cursorbridge.ProgressFn
	if !warm {
		progress = func(stage, detail string) {
			emit(guest.Event{Kind: guest.EventProgress, Stage: stage, Text: detail, Tool: "cursor_bridge", Args: detail})
		}
		progress("ensure", "正在准备 Cursor SDK Bridge…")
	}
	cli, err := b.sess.Ensure(ctx, progress)
	if err != nil {
		if !warm {
			emit(guest.Event{Kind: guest.EventToolEnd, Tool: "cursor_bridge", Status: "error", Summary: err.Error()})
		}
		return "", err
	}
	if !warm {
		emit(guest.Event{Kind: guest.EventToolEnd, Tool: "cursor_bridge", Status: "ok", Summary: "Bridge 已就绪（本进程内将复用）"})
	}

	if in.Root != "" && strings.TrimSpace(in.SystemPrompt) != "" {
		_ = history.EnsureSystem(in.Root, in.SessionKey, in.SystemPrompt)
	}
	if !in.SkipUserAppend && in.Root != "" {
		_ = history.Append(in.Root, in.SessionKey, history.Msg{
			Role: "user", Content: in.Prompt, TaskID: in.TaskID,
		})
	}

	opts := cursorbridge.CreateAgentOpts{
		APIKey:      apiKey,
		Model:       in.Model,
		CWD:         b.Workspace(),
		Mode:        mapCursorMode(in.Mode),
		CustomTools: b.customTools(tools, in.Mode),
	}
	agentID := b.loadAgentID(in.SessionKey)
	if agentID != "" {
		if _, err := cli.ResumeAgent(ctx, agentID, opts); err != nil {
			agentID = ""
		}
	}
	if agentID == "" {
		agentID, err = cli.CreateAgent(ctx, opts)
		if err != nil {
			if len(opts.CustomTools) > 0 {
				opts.CustomTools = nil
				agentID, err = cli.CreateAgent(ctx, opts)
			}
			if err != nil {
				return "", fmt.Errorf("CreateAgent: %w", err)
			}
			emit(guest.Event{Kind: guest.EventToolEnd, Tool: "cursor_bridge", Status: "ok", Summary: "已创建 Agent（工作台工具未挂载，请重启 App）"})
		}
		b.saveAgentID(in.SessionKey, agentID)
	}

	if n, _ := cli.CancelActiveRuns(ctx, agentID, apiKey); n > 0 {
		emit(guest.Event{Kind: guest.EventProgress, Tool: "cursor_bridge", Args: fmt.Sprintf("已取消 %d 个未结束的 Cursor run", n)})
		emit(guest.Event{Kind: guest.EventToolEnd, Tool: "cursor_bridge", Status: "ok", Summary: "已清理卡住的 run"})
	}

	recent := in.RecentDialog
	if recent == "" && in.Root != "" {
		recent = recentDialog(in.Root, in.SessionKey)
	}
	msg := buildCursorUserMessage(in.Prompt, in.Feedforward, in.Mode, recent)
	return b.send(ctx, cli, agentID, apiKey, opts, in.SessionKey, msg, emit)
}

func (b *CursorBrain) customTools(tools guest.Tools, mode string) map[string]cursorbridge.CustomTool {
	specs := tools.ListSpecs(mode)
	out := make(map[string]cursorbridge.CustomTool, len(specs))
	for _, sp := range specs {
		out[sp.Name] = cursorbridge.CustomTool{
			Description: sp.Description,
			InputSchema: sp.Parameters,
		}
	}
	return out
}

func (b *CursorBrain) onTool(httpCtx context.Context, toolName string, args json.RawMessage, toolCallID, agentID string) (map[string]interface{}, error) {
	_ = httpCtx
	_ = agentID
	b.mu.Lock()
	tools := b.tools
	emit := b.emit
	b.mu.Unlock()
	if tools == nil {
		return map[string]interface{}{"ok": false, "error": "tool surface 未绑定回合"}, nil
	}
	argsStr := string(args)
	if strings.TrimSpace(argsStr) == "" {
		argsStr = "{}"
	}
	callID := strings.TrimSpace(toolCallID)
	if emit != nil {
		emit(guest.Event{Kind: guest.EventToolStart, Tool: toolName, CallID: callID, Args: argsStr})
	}
	inv, err := tools.Invoke(context.Background(), toolName, args, toolCallID)
	if err != nil {
		if emit != nil {
			emit(guest.Event{Kind: guest.EventToolEnd, Tool: toolName, CallID: callID, Status: "error", Summary: err.Error()})
		}
		return map[string]interface{}{"ok": false, "error": err.Error()}, nil
	}
	if emit != nil {
		st, sum := statusOf(inv)
		if inv.ResourceID > 0 {
			sum = fmt.Sprintf("%s · #%d", sum, inv.ResourceID)
		}
		emit(guest.Event{
			Kind: guest.EventToolEnd, Tool: toolName, CallID: inv.CallID,
			Status: st, Summary: sum, ResultJSON: inv.Body, ResourceID: inv.ResourceID,
		})
	}
	var asMap map[string]interface{}
	if json.Unmarshal(inv.Body, &asMap) != nil {
		return map[string]interface{}{"ok": inv.OK, "raw": string(inv.Body)}, nil
	}
	return asMap, nil
}

func (b *CursorBrain) send(
	ctx context.Context,
	cli *cursorbridge.Client,
	agentID, apiKey string,
	opts cursorbridge.CreateAgentOpts,
	sessionKey, msg string,
	emit guest.Emit,
) (string, error) {
	onEv := func(ev cursorbridge.SendEvent) {
		switch ev.Kind {
		case "assistant_delta", "assistant":
			if ev.Text != "" {
				emit(guest.Event{Kind: guest.EventTextDelta, Text: ev.Text})
			}
		}
	}
	final, _, err := cli.Send(ctx, agentID, msg, onEv)
	if err == nil || !strings.Contains(err.Error(), "already has active run") {
		return final, err
	}
	_, _ = cli.CancelActiveRuns(ctx, agentID, apiKey)
	final, _, err = cli.Send(ctx, agentID, msg, onEv)
	if err == nil || !strings.Contains(err.Error(), "already has active run") {
		return final, err
	}
	b.saveAgentID(sessionKey, "")
	newID, cerr := cli.CreateAgent(ctx, opts)
	if cerr != nil {
		return "", fmt.Errorf("%v；重建 Agent 失败: %w", err, cerr)
	}
	b.saveAgentID(sessionKey, newID)
	final, _, err = cli.Send(ctx, newID, msg, onEv)
	return final, err
}

func (b *CursorBrain) loadAgentID(sessionKey string) string {
	if b.ids == nil {
		return ""
	}
	v, _ := b.ids.GetAppSetting(cursorAgentKey(sessionKey))
	return strings.TrimSpace(v)
}

func (b *CursorBrain) saveAgentID(sessionKey, agentID string) {
	if b.ids == nil {
		return
	}
	_ = b.ids.SetAppSetting(cursorAgentKey(sessionKey), agentID)
}

func cursorAgentKey(sessionKey string) string {
	return "cursor_agent_" + strings.TrimSpace(sessionKey)
}

func mapCursorMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "plan") {
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

func recentDialog(root, sessionKey string) string {
	if strings.TrimSpace(root) == "" || strings.TrimSpace(sessionKey) == "" {
		return ""
	}
	all, err := history.Load(root, sessionKey)
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

func statusOf(inv guest.InvokeResult) (status, summary string) {
	summary = strings.TrimSpace(inv.ConfirmSummary)
	if summary == "" && inv.Error != "" {
		summary = inv.Error
	}
	if summary == "" {
		summary = "ok"
	}
	if inv.NeedsConfirm {
		return "need_confirm", summary
	}
	if inv.NeedsChoice {
		return "need_choice", summary
	}
	if inv.OK {
		return "ok", summary
	}
	return "error", summary
}

// TestConnection Ping + Me。
func (b *CursorBrain) TestConnection(ctx context.Context) (string, error) {
	apiKey := strings.TrimSpace(b.apiKey)
	if apiKey == "" {
		return "", fmt.Errorf("请先保存 CURSOR_API_KEY")
	}
	if err := b.Ensure(ctx, nil); err != nil {
		return "", err
	}
	cli, err := b.sess.Ensure(ctx, nil)
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
	return "Cursor Bridge 连接成功: " + who + " · " + filepath.Base(b.Workspace()), nil
}
