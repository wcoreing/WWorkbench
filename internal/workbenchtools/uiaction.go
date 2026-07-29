package workbenchtools

import "WWorkbench/internal/workbench"

// UIActionKind 工作台 UI 联动动作（与 internal/workbench/capability.go 一致）。
type UIActionKind string

const (
	UIActionTerminalOpen   UIActionKind = UIActionKind(workbench.CapOpenTerminal)
	UIActionTerminalExec   UIActionKind = UIActionKind(workbench.CapTerminalExec)
	UIActionDatabaseOpen   UIActionKind = UIActionKind(workbench.CapDatabaseOpen)
)

// UIActionBus 向前端投递 UI 联动（经 Wails agent:ui_action 事件）。
type UIActionBus struct {
	emit func(event string, payload map[string]interface{})
}

// NewUIActionBus 创建 UI 联动总线。
func NewUIActionBus(emit func(event string, payload map[string]interface{})) *UIActionBus {
	return &UIActionBus{emit: emit}
}

// Dispatch 发送 UI 动作到前端。
func (b *UIActionBus) Dispatch(kind UIActionKind, payload map[string]interface{}) {
	if b == nil || b.emit == nil {
		return
	}
	if payload == nil {
		payload = map[string]interface{}{}
	}
	payload["kind"] = string(kind)
	b.emit("agent:ui_action", payload)
}
