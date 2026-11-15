package mcpserver

import (
	"fmt"
	"net/http"
	"strings"

	"WWorkbench/internal/workbenchtools"

	"github.com/mark3labs/mcp-go/server"
	"github.com/wcoreing/ningharness/toolgateway"
)

// DefaultHTTPAddr WWorkbench MCP 默认监听（避开 ningharness 51020 / agentdesk 50423）。
const DefaultHTTPAddr = "127.0.0.1:51021"

// ServerVersion MCP serverInfo.version（与 AppVersion 同步递增）。
const ServerVersion = "0.54.543"

// WorkbenchMCPInstructions /mcp/workbench 驾驭说明（前馈；不因未读规则拒绝工具）。
const WorkbenchMCPInstructions = `WWorkbench MCP：工作台能力面（数据库 / 终端 / Docker / HTTP / 日志 / 笔记本 / 浏览器舞台 / 备份 / 插件等）。
- 【前馈】本段即系统约束摘要；可选 get_agent_rules(domain?) 复核全文。不会因未调用 get_agent_rules 而拒绝工具。
- 【意图】动手类请传 intent（人话：要干什么、影响谁）；缺省时系统会合成「未声明意图」卡片，仍继续执行，确认弹窗与舞台可见。
- 【鉴权】URL ?token= 或 Authorization Bearer（设置页可复制 mcp.json）；/health 免鉴权。勿用假 token（Cursor 会卡 Authenticating）。
- 【备份】host_health_scan(sshHostId, workDir) → 用户勾选后 ensure_host_backup_policies(findingIds)；或 save_backup_policy → run_backup 无头。禁止全盘扫、禁止默认全选。
- 参数=schema 顶层字段（勿再包 {"arguments":…}）。
- 危险写操作在工作台弹窗拍板（工具阻塞至用户确认；与看过程同一视线）。含：SQL/容器/插件/run_backup，以及 shell_run 风险命令。终端右键「允许 MCP 写入当前目录」后软文件写可免确认；数据硬风险（rsync/scp/cp 碰 *.db/data/.env、库导入）不可免。确认后：rsync 自动 exclude；写前备份。勿解析 ww_confirm 文本。
- 能解析到 SSH 的操作会先打开/聚焦对应终端 + 状态栏。shell_run 返回 updatedAt → 立刻 get_shell_output(waitMs, afterUpdatedAt)。shell_probe=无头只读短探针。断线先 terminal_reconnect。
- 容器启停删用 start/stop/remove_container，勿用 shell_probe 跑 docker rm。
- 词典：任务=目标；账本=thought+op→log.md；Skill=任意目录 SKILL.md。对外只认 list/get/update/run/distill_skill（旧 *workflow / update_agent_skill 已别名转发）。闭环：接目标→task_record/browser_*→update_skill。禁止任务场景直连 10086/18765。样板 get_skill(wwb-skill-standard)。
- 浏览器：browser_*；等壳；fill(fields)；可写宏 browser_run(mode=macro)。自学习：探索记 log → 收口 update_skill（稳定段写成一条 browser_run 步骤）→ get_skill/run_skill。标注样板：建 task → navigate 等壳 → 标签/Submit → network verify。
- 笔记本：list_notes / get_note / get_skill；动手前读主机 memory。插件 UI：先 get_plugin_protocol。
- 工具受「AI 能力权限」开关约束。Cursor 配置本端点 /mcp/workbench（非 /mcp）。`

// NewHandler 组装 /mcp、/mcp/workbench、/health。不监听端口。
// authToken 非空时对非 /health 路径要求 Bearer；CORS 仅本机 Origin。
// 两端都无状态：Cursor 空闲挂起后带着旧 session 再调，不会因会话失效被 404。
func NewHandler(gw *toolgateway.Gateway, reg *workbenchtools.Registry, authToken string) (http.Handler, error) {
	if gw == nil {
		return nil, fmt.Errorf("nil gateway")
	}
	if reg == nil {
		return nil, fmt.Errorf("nil registry")
	}
	_ = strings.TrimSpace(authToken)
	core := server.NewStreamableHTTPServer(
		toolgateway.NewMCPServer(gw, "wworkbench", ServerVersion, "ningharness core tools hosted by WWorkbench"),
		server.WithEndpointPath("/mcp"),
		server.WithStateLess(true),
	)
	wb := server.NewStreamableHTTPServer(
		NewWorkbenchMCPServer(gw, reg),
		server.WithEndpointPath("/mcp/workbench"),
		server.WithStateLess(true),
	)
	mux := http.NewServeMux()
	mux.Handle("/mcp", core)
	mux.Handle("/mcp/workbench", wb)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeRestrictedCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"ready":true,"name":"wworkbench","mcp":"/mcp","auth":"bearer"}`))
	})
	// Endpoint.serve 已鉴权；此处再包一层，便于单测 / 非 Endpoint 挂载。
	return withAuth(authToken, mux), nil
}
