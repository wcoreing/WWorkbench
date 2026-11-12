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

// ResolveExecutor 显式 hint 优先；否则 wwb 已连接用 wwb，否则 kimi 可用则 kimi。
func ResolveExecutor(ctx context.Context, hint string, wwb, kimi Executor) (Executor, string, error) {
	hint = strings.ToLower(strings.TrimSpace(hint))
	switch hint {
	case ExecutorNameKimi:
		if kimi != nil && kimi.Available(ctx) {
			return kimi, ExecutorNameKimi, nil
		}
		return nil, "", errStr("executor=kimi 但 Kimi WebBridge 不可用（检查 127.0.0.1:10086）")
	case ExecutorNameWWB, "ext", "bridge":
		if wwb != nil && wwb.Available(ctx) {
			return wwb, ExecutorNameWWB, nil
		}
		return nil, "", errStr("executor=wwb 但浏览器扩展未连接")
	case "":
		if wwb != nil && wwb.Available(ctx) {
			return wwb, ExecutorNameWWB, nil
		}
		if kimi != nil && kimi.Available(ctx) {
			return kimi, ExecutorNameKimi, nil
		}
		return nil, "", errStr("无可用浏览器执行器：请连接 WWorkbench 扩展或启动 Kimi WebBridge")
	default:
		return nil, "", errStr("未知 executor: " + hint + "（用 wwb 或 kimi）")
	}
}

type errStr string

func (e errStr) Error() string { return string(e) }

// ExecutorsStatus 供 browser_status 展示。
func ExecutorsStatus(ctx context.Context, wwb, kimi Executor) map[string]interface{} {
	out := map[string]interface{}{}
	if wwb != nil {
		out[ExecutorNameWWB] = map[string]interface{}{
			"available": wwb.Available(ctx),
			"addr":      DefaultAddr,
		}
	}
	if kimi != nil {
		out[ExecutorNameKimi] = map[string]interface{}{
			"available": kimi.Available(ctx),
			"addr":      KimiDefaultAddr,
		}
	}
	return out
}
