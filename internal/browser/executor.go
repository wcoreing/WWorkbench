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

// ResolveExecutor 显式 hint 优先；auto/空：优先 wwb（已含 CDP AX 快照），单边则用可用者。
func ResolveExecutor(ctx context.Context, hint string, wwb, kimi Executor) (Executor, string, error) {
	return ResolveExecutorForAction(ctx, hint, "", wwb, kimi)
}

// ResolveExecutorForAction 可按 action 做 sticky-safe 的偏好（同会话仍建议固定 hint）。
func ResolveExecutorForAction(ctx context.Context, hint, action string, wwb, kimi Executor) (Executor, string, error) {
	hint = strings.ToLower(strings.TrimSpace(hint))
	action = strings.ToLower(strings.TrimSpace(action))
	wwbOK := wwb != nil && wwb.Available(ctx)
	kimiOK := kimi != nil && kimi.Available(ctx)

	switch hint {
	case ExecutorNameKimi:
		if kimiOK {
			return kimi, ExecutorNameKimi, nil
		}
		return nil, "", errStr("executor=kimi 但 Kimi WebBridge 不可用（检查 127.0.0.1:10086）")
	case ExecutorNameWWB, "ext", "bridge":
		if wwbOK {
			return wwb, ExecutorNameWWB, nil
		}
		return nil, "", errStr("executor=wwb 但浏览器扩展未连接")
	case "", "auto":
		// 默认 wwb（AX 快照 + 指针/拖拽/上传）；kimi 仅在 wwb 不可用或显式指定时
		_ = action
		if wwbOK {
			return wwb, ExecutorNameWWB, nil
		}
		if kimiOK {
			return kimi, ExecutorNameKimi, nil
		}
		return nil, "", errStr("无可用浏览器执行器：请连接 WWorkbench 扩展或启动 Kimi WebBridge")
	default:
		return nil, "", errStr("未知 executor: " + hint + "（用 wwb、kimi 或 auto）")
	}
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
func ExecutorsStatus(ctx context.Context, wwb, kimi Executor) map[string]interface{} {
	out := map[string]interface{}{}
	if wwb != nil {
		out[ExecutorNameWWB] = map[string]interface{}{
			"available":    wwb.Available(ctx),
			"addr":         DefaultAddr,
			"capabilities": WWBCapabilities,
		}
	}
	if kimi != nil {
		out[ExecutorNameKimi] = map[string]interface{}{
			"available":    kimi.Available(ctx),
			"addr":         KimiDefaultAddr,
			"capabilities": KimiCapabilities,
			"note":         "经 browser_*(executor=kimi|auto) 调用；入参/截图/wait 已做适配，效果对齐直连 10086",
		}
	}
	out["recommended"] = map[string]interface{}{
		"forms_snapshot_click": ExecutorNameWWB,
		"drag_pointer":         ExecutorNameWWB,
		"default_auto":         "优先 wwb（CDP AX 快照）；kimi 作显式/回退",
	}
	return out
}
