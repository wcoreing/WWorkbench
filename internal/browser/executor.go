package browser

import (
	"context"
	"encoding/json"
	"strings"
)

// Executor 浏览器操作执行器（插件）；任务账本与执行器解耦。
type Executor interface {
	Name() string
	Available(ctx context.Context) bool
	Call(ctx context.Context, action string, args json.RawMessage, session string) (json.RawMessage, error)
}

// ExecutorInfo 可选：执行器自述（地址/能力/前馈提示），供 browser_status 展示。
type ExecutorInfo interface {
	Info(ctx context.Context) map[string]interface{}
}

// ExecutorNameWWB 自有扩展桥。
const ExecutorNameWWB = "wwb"

// ExecutorNameKimi Kimi WebBridge。
const ExecutorNameKimi = "kimi"

// WWBExecutor 包装本机 Bridge。
type WWBExecutor struct {
	Bridge *Bridge
}

func (e *WWBExecutor) Name() string { return ExecutorNameWWB }

func (e *WWBExecutor) Available(_ context.Context) bool {
	if e == nil || e.Bridge == nil {
		return false
	}
	st := e.Bridge.Status()
	return st.Listening && st.ExtensionConnected
}

func (e *WWBExecutor) Info(_ context.Context) map[string]interface{} {
	return map[string]interface{}{"addr": DefaultAddr, "capabilities": WWBCapabilities}
}

func (e *WWBExecutor) Call(ctx context.Context, action string, args json.RawMessage, session string) (json.RawMessage, error) {
	if e == nil || e.Bridge == nil {
		return nil, errStr("wwb 执行器未就绪")
	}
	var v interface{}
	if len(args) == 0 || string(args) == "null" {
		v = map[string]interface{}{}
	} else if err := json.Unmarshal(args, &v); err != nil {
		return nil, err
	}
	return e.Bridge.CallSession(ctx, action, v, session)
}

// executorAliases hint 别名 → 执行器名。
var executorAliases = map[string]string{
	"ext": ExecutorNameWWB, "bridge": ExecutorNameWWB,
	"ab": ExecutorNameAgentBrowser, "agentbrowser": ExecutorNameAgentBrowser, "agent_browser": ExecutorNameAgentBrowser,
}

// executorMissing 显式指定但不可用时，告诉调用方怎么让它可用。
var executorMissing = map[string]string{
	ExecutorNameWWB:          "executor=wwb 但浏览器扩展未连接",
	ExecutorNameKimi:         "executor=kimi 但 Kimi WebBridge 不可用（检查 127.0.0.1:10086）",
	ExecutorNameAgentBrowser: "executor=agent-browser 但未找到可执行文件（" + AgentBrowserInstallHint + "）",
}

// ResolveExecutor 显式 hint 优先；auto/空：按传入顺序取第一个可用者。
func ResolveExecutor(ctx context.Context, hint string, execs ...Executor) (Executor, string, error) {
	return ResolveExecutorForAction(ctx, hint, "", execs...)
}

// ResolveExecutorForAction 可按 action 做 sticky-safe 的偏好（同会话仍建议固定 hint）。
// execs 的顺序即 auto 的优先级；调用方约定 wwb → kimi → agent-browser。
func ResolveExecutorForAction(ctx context.Context, hint, action string, execs ...Executor) (Executor, string, error) {
	hint = strings.ToLower(strings.TrimSpace(hint))
	if name, ok := executorAliases[hint]; ok {
		hint = name
	}
	_ = action
	if hint == "" || hint == "auto" {
		for _, ex := range execs {
			if ex != nil && ex.Available(ctx) {
				return ex, ex.Name(), nil
			}
		}
		return nil, "", errStr("无可用浏览器执行器：请连接 WWorkbench 扩展、启动 Kimi WebBridge，或安装 agent-browser（" + AgentBrowserInstallHint + "）")
	}
	for _, ex := range execs {
		if ex == nil || ex.Name() != hint {
			continue
		}
		if ex.Available(ctx) {
			return ex, hint, nil
		}
		if msg, ok := executorMissing[hint]; ok {
			return nil, "", errStr(msg)
		}
		return nil, "", errStr("executor=" + hint + " 不可用")
	}
	return nil, "", errStr("未知 executor: " + hint + "（用 wwb、kimi、agent-browser 或 auto）")
}

func preferWWBPointer(action string) bool {
	switch action {
	case "drag", "upload", "mouse_click", "select_option", "open_frame":
		return true
	default:
		return false
	}
}

type errStr string

func (e errStr) Error() string { return string(e) }

// ExecutorsStatus 供 browser_status 展示。
func ExecutorsStatus(ctx context.Context, execs ...Executor) map[string]interface{} {
	out := map[string]interface{}{}
	for _, ex := range execs {
		if ex == nil {
			continue
		}
		st := map[string]interface{}{"available": ex.Available(ctx)}
		if d, ok := ex.(ExecutorInfo); ok {
			for k, v := range d.Info(ctx) {
				st[k] = v
			}
		}
		out[ex.Name()] = st
	}
	out["recommended"] = map[string]interface{}{
		"forms_snapshot_click": ExecutorNameWWB,
		"drag_pointer":         ExecutorNameWWB,
		"borrow_user_tabs":     ExecutorNameWWB,
		"no_extension":         ExecutorNameAgentBrowser,
		"default_auto":         "优先 wwb（CDP AX 快照，可借用户已登录的标签）；其次 kimi；都不可用时落到 agent-browser（独立浏览器，免装扩展）",
	}
	return out
}
