package workbenchtools

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

// DefaultMCPConfirmTimeout 外置 MCP 危险操作在工作台等待拍板的默认超时。
const DefaultMCPConfirmTimeout = 5 * time.Minute

// MCPConfirmRequest 投递给前端的确认请求。
type MCPConfirmRequest struct {
	PendingID string          `json:"pendingId"`
	ToolName  string          `json:"toolName"`
	Summary   string          `json:"summary"`
	Preview   json.RawMessage `json:"preview,omitempty"`
	Product   string          `json:"product,omitempty"`
}

type mcpPending struct {
	ch chan bool
}

// MCPConfirmGate 外置 MCP 写操作 → 工作台弹窗拍板。
type MCPConfirmGate struct {
	emit func(event string, payload map[string]interface{})
	mu   sync.Mutex
	wait map[string]*mcpPending
}

// NewMCPConfirmGate 创建确认门（经 Wails 事件 mcp:confirm）。
func NewMCPConfirmGate(emit func(event string, payload map[string]interface{})) *MCPConfirmGate {
	return &MCPConfirmGate{
		emit: emit,
		wait: make(map[string]*mcpPending),
	}
}

// Await 弹出工作台确认并阻塞至 Resolve / 超时 / ctx 取消。
func (g *MCPConfirmGate) Await(ctx context.Context, req MCPConfirmRequest) (approved bool, err error) {
	if g == nil {
		return false, errMCPConfirmUnavailable
	}
	pendingID := req.PendingID
	if pendingID == "" {
		pendingID = uuid.NewString()
		req.PendingID = pendingID
	}
	ch := make(chan bool, 1)
	g.mu.Lock()
	if g.wait == nil {
		g.wait = make(map[string]*mcpPending)
	}
	// 同 id 替换旧等待
	if old, ok := g.wait[pendingID]; ok {
		select {
		case old.ch <- false:
		default:
		}
	}
	g.wait[pendingID] = &mcpPending{ch: ch}
	g.mu.Unlock()

	payload := map[string]interface{}{
		"pendingId": pendingID,
		"toolName":  req.ToolName,
		"summary":   req.Summary,
		"product":   req.Product,
	}
	if len(req.Preview) > 0 {
		payload["preview"] = json.RawMessage(req.Preview)
	}
	if g.emit != nil {
		g.emit("mcp:confirm", payload)
	}

	timeout := DefaultMCPConfirmTimeout
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case ok := <-ch:
		g.mu.Lock()
		delete(g.wait, pendingID)
		g.mu.Unlock()
		return ok, nil
	case <-waitCtx.Done():
		g.mu.Lock()
		delete(g.wait, pendingID)
		g.mu.Unlock()
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		return false, errMCPConfirmTimeout
	}
}

// Resolve 用户在工作台拍板。
func (g *MCPConfirmGate) Resolve(pendingID string, approved bool) bool {
	if g == nil || pendingID == "" {
		return false
	}
	g.mu.Lock()
	p, ok := g.wait[pendingID]
	if ok {
		delete(g.wait, pendingID)
	}
	g.mu.Unlock()
	if !ok || p == nil {
		return false
	}
	select {
	case p.ch <- approved:
	default:
	}
	return true
}

var (
	errMCPConfirmUnavailable = failErr("工作台确认门未就绪")
	errMCPConfirmTimeout     = failErr("工作台确认超时（未在时限内拍板）")
)

type failErr string

func (e failErr) Error() string { return string(e) }

// ProductForTool 危险操作对应的工作台产品线（便于亮舞台）。
func ProductForTool(toolName string) string {
	switch toolName {
	case "execute_sql":
		return "database"
	case "execute_http":
		return "httpapi"
	case "start_container", "stop_container", "remove_container":
		// 与「看过程」同一视线：确认时留在终端舞台（远端已由 stageDockerContext 打开 SSH）
		return "terminal"
	case "shell_run", "open_terminal", "terminal.open", "terminal_open", "run_backup":
		return "terminal"
	case workbench.CapEnsureHostBackupPolicies, workbench.CapHostHealthScan, workbench.CapBackupOpen:
		return "backup"
	case "edit_plugin_pack_file", "write_plugin_pack_file", "build_plugin_pack_ui", "rollback_plugin_pack":
		return "plugins"
	case workbench.CapBrowserClick, workbench.CapBrowserFill, workbench.CapBrowserUpload,
		workbench.CapBrowserSelectOption, workbench.CapBrowserDrag,
		workbench.CapBrowserNavigate, workbench.CapBrowserKeys, workbench.CapBrowserOpenFrame,
		workbench.CapBrowserStatus, workbench.CapBrowserListTabs,
		workbench.CapBrowserAttach, workbench.CapBrowserSnapshot, workbench.CapBrowserFind,
		workbench.CapBrowserWait, workbench.CapBrowserScreenshot, workbench.CapBrowserReadPage,
		workbench.CapBrowserOpen, workbench.CapBrowserFindTab, workbench.CapBrowserGroupSession,
		workbench.CapBrowserCloseSession, workbench.CapBrowserRun, workbench.CapBrowserEvaluate,
		workbench.CapBrowserNetwork, workbench.CapListTaskRuns, workbench.CapGetTaskRun,
		workbench.CapReplayTaskStep, workbench.CapDistillWorkflow, workbench.CapListWorkflows,
		workbench.CapGetWorkflow, workbench.CapSaveWorkflow, workbench.CapUpdateSkill, workbench.CapRunSkill,
		workbench.CapListSkills, workbench.CapGetSkill,
		workbench.CapListDirVersions, workbench.CapEnableDirVersion, workbench.CapPinDirVersion, workbench.CapRestoreDirVersion,
		workbench.CapListSkillVersions, workbench.CapPinSkillVersion, workbench.CapRestoreSkillVersion:
		return "browser"
	default:
		return "terminal"
	}
}
