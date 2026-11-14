package brain

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/harness"
	"WWorkbench/internal/workbenchtools"

	"github.com/google/uuid"
	"github.com/wcoreing/ningharness/guest"
)

// ToolHost 工具执行依赖（ningharness Host 子集）。
type ToolHost interface {
	CallTool(ctx context.Context, name string, args json.RawMessage) workbenchtools.ToolResult
	PutToolCall(threadID, taskID, callID, name, args string) (int64, string, error)
	PutToolResult(threadID, taskID, callID, name, body string) (int64, string, error)
}

// ConfirmFn NeedsConfirm 时由产品执行（侧栏自动确认 / MCP 门）。
type ConfirmFn func(ctx context.Context, toolName, argsJSON string) workbenchtools.ToolResult

// ToolSurface 实现 guest.Tools：工作台 Registry + Gateway + 确认门。
type ToolSurface struct {
	Registry *workbenchtools.Registry
	Host     ToolHost
	Confirm  ConfirmFn

	mu   sync.Mutex
	turn turnBind
}

type turnBind struct {
	ThreadID string
	TaskID   string
	Ctx      context.Context
}

// NewToolSurface 创建工具面。
func NewToolSurface(reg *workbenchtools.Registry, host ToolHost, confirm ConfirmFn) *ToolSurface {
	return &ToolSurface{Registry: reg, Host: host, Confirm: confirm}
}

var _ guest.Tools = (*ToolSurface)(nil)

// BindTurn 绑定本轮 session/task/ctx（含 caller）。
func (s *ToolSurface) BindTurn(sessionKey, taskID string, ctx context.Context) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	s.turn = turnBind{ThreadID: sessionKey, TaskID: taskID, Ctx: ctx}
	s.mu.Unlock()
}

// ClearTurn 回合结束清理绑定。
func (s *ToolSurface) ClearTurn() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.turn = turnBind{}
	s.mu.Unlock()
}

func (s *ToolSurface) turnSnapshot() turnBind {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turn
}

// ListSpecs 按权限与模式列出本轮可见工具。
func (s *ToolSurface) ListSpecs(mode string) []guest.ToolSpec {
	if s == nil || s.Registry == nil {
		return nil
	}
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "" {
		mode = "agent"
	}
	if mode == "ask" {
		return nil
	}
	perms := s.Registry.Deps().EffectivePermissions()
	defs := s.Registry.ListDefsFiltered(perms)
	if s.Host != nil {
		for _, d := range harness.MemoryToolDefs() {
			if perms != nil && !workbenchtools.IsToolEnabled(perms, d.Name) {
				continue
			}
			defs = append(defs, d)
		}
		for _, d := range harness.SkillToolDefs() {
			if perms != nil && !workbenchtools.IsToolEnabled(perms, d.Name) {
				continue
			}
			defs = append(defs, d)
		}
	}
	out := make([]guest.ToolSpec, 0, len(defs))
	for _, d := range defs {
		if mode == "plan" && agentcap.RiskOf(d.Name) != agentcap.RiskRead {
			continue
		}
		schema := d.Parameters
		if schema == nil {
			schema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		out = append(out, guest.ToolSpec{Name: d.Name, Description: d.Description, Parameters: schema})
	}
	return out
}

// Invoke 经 Gateway 执行工具。
func (s *ToolSurface) Invoke(_ context.Context, toolName string, args json.RawMessage, toolCallID string) (guest.InvokeResult, error) {
	if s == nil || s.Host == nil {
		body, _ := json.Marshal(map[string]interface{}{"ok": false, "error": "tool surface 未就绪"})
		return guest.InvokeResult{
			CallID: toolCallID, OK: false, Error: "tool surface 未就绪", Body: body,
		}, nil
	}
	bind := s.turnSnapshot()
	execCtx := bind.Ctx
	if execCtx == nil {
		execCtx = context.Background()
	}
	name := strings.TrimSpace(toolName)
	callID := strings.TrimSpace(toolCallID)
	if callID == "" {
		callID = uuid.NewString()
	}
	argsStr := string(args)
	if strings.TrimSpace(argsStr) == "" {
		argsStr = "{}"
		args = json.RawMessage(`{}`)
	}
	_, _, _ = s.Host.PutToolCall(bind.ThreadID, bind.TaskID, callID, name, argsStr)
	result := s.Host.CallTool(execCtx, name, args)
	if result.NeedsConfirm && s.Confirm != nil {
		result = s.Confirm(execCtx, name, argsStr)
	}
	body, _ := json.Marshal(result)
	rid, _, _ := s.Host.PutToolResult(bind.ThreadID, bind.TaskID, callID, name, string(body))
	return guest.InvokeResult{
		CallID:         callID,
		OK:             result.OK,
		NeedsConfirm:   result.NeedsConfirm,
		NeedsChoice:    result.NeedsChoice,
		Error:          result.Error,
		ConfirmSummary: result.ConfirmSummary,
		Body:           body,
		ResourceID:     rid,
	}, nil
}
