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
	// ConfirmLabel 确认按钮文案；空则用默认「执行」。
	ConfirmLabel string `json:"confirmLabel,omitempty"`
}

type mcpConfirmDecision struct {
	Approved bool
	Trust    bool
}

type mcpPending struct {
	ch chan mcpConfirmDecision
}

// MCPConfirmGate 外置 MCP 写操作 → 工作台弹窗拍板。
type MCPConfirmGate struct {
	emit func(event string, payload map[string]interface{})
	mu   sync.Mutex
	wait map[string]*mcpPending
	// skill_offer 去重（同 name+lessons 短时不重复弹）
	skillOfferMu   sync.Mutex
	skillOfferLast map[string]time.Time
}

// NewMCPConfirmGate 创建确认门（经 Wails 事件 mcp:confirm）。
func NewMCPConfirmGate(emit func(event string, payload map[string]interface{})) *MCPConfirmGate {
	return &MCPConfirmGate{
		emit: emit,
		wait: make(map[string]*mcpPending),
	}
}

// Await 弹出工作台确认并阻塞至 Resolve / 超时 / ctx 取消。
// trust=true 表示用户点了「信任并执行」（仅非硬风险）。
func (g *MCPConfirmGate) Await(ctx context.Context, req MCPConfirmRequest) (approved, trust bool, err error) {
	if g == nil {
		return false, false, errMCPConfirmUnavailable
	}
	pendingID := req.PendingID
	if pendingID == "" {
		pendingID = uuid.NewString()
		req.PendingID = pendingID
	}
	ch := make(chan mcpConfirmDecision, 1)
	g.mu.Lock()
	if g.wait == nil {
		g.wait = make(map[string]*mcpPending)
	}
	// 同 id 替换旧等待
	if old, ok := g.wait[pendingID]; ok {
		select {
		case old.ch <- mcpConfirmDecision{}:
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
	if req.ConfirmLabel != "" {
		payload["confirmLabel"] = req.ConfirmLabel
	}
	if g.emit != nil {
		g.emit("mcp:confirm", payload)
	}

	timeout := DefaultMCPConfirmTimeout
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case dec := <-ch:
		g.mu.Lock()
		delete(g.wait, pendingID)
		g.mu.Unlock()
		return dec.Approved, dec.Approved && dec.Trust, nil
	case <-waitCtx.Done():
		g.mu.Lock()
		delete(g.wait, pendingID)
		g.mu.Unlock()
		if ctx.Err() != nil {
			return false, false, ctx.Err()
		}
		return false, false, errMCPConfirmTimeout
	}
}

// EmitStage 向前端推送阶段短讯（mcp:stage → 状态栏）；拍板细节在 ConfirmDialog。
func (g *MCPConfirmGate) EmitStage(kind, label, intent, impact, tool string) {
	if g == nil || g.emit == nil {
		return
	}
	payload := map[string]interface{}{
		"kind":  kind,
		"label": label,
		"at":    time.Now().UnixMilli(),
	}
	if intent != "" {
		payload["intent"] = intent
	}
	if impact != "" {
		payload["impact"] = impact
	}
	if tool != "" {
		payload["tool"] = tool
	}
	if product := ProductForTool(tool); product != "" {
		payload["product"] = product
	}
	g.emit("mcp:stage", payload)
}

// Resolve 用户在工作台拍板；trust 仅在 approved 时生效。
func (g *MCPConfirmGate) Resolve(pendingID string, approved, trust bool) bool {
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
	case p.ch <- mcpConfirmDecision{Approved: approved, Trust: approved && trust}:
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
	if isDesktopTool(toolName) {
		return "" // 桌面应用在工作台之外，确认时不切舞台
	}
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
	case workbench.CapListProjects, workbench.CapGetProject, workbench.CapSaveProject, workbench.CapDeleteProject,
		workbench.CapSuggestProjectResources, workbench.CapConfigureProjectResources, workbench.CapDetectProjectGit,
		workbench.CapSyncProjectCursorTranscripts, workbench.CapListProjectCursorTranscripts, workbench.CapGetProjectCursorTranscript,
		workbench.CapEnsureCursorStageRule, workbench.CapOpenProjectStage:
		return "project"
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
		workbench.CapListMCPLogs, workbench.CapGetMCPLog,
		workbench.CapReplayTaskStep, workbench.CapRunSkill:
		return "browser"
	// Skill 跟资源走：确认时亮笔记本，勿切任务页（项目收口 update_skill 尤甚）。
	case workbench.CapDistillSkill, workbench.CapUpdateSkill,
		workbench.CapListSkills, workbench.CapGetSkill, workbench.CapPublishAgentSkill,
		workbench.CapListDirVersions, workbench.CapEnableDirVersion, workbench.CapPinDirVersion, workbench.CapRestoreDirVersion,
		workbench.CapListSkillVersions, workbench.CapPinSkillVersion, workbench.CapRestoreSkillVersion:
		return "notebook"
	default:
		return "terminal"
	}
}
