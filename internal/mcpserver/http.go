package mcpserver

import (
	"fmt"
	"net/http"
	"strings"

	"WWorkbench/internal/buildinfo"
	"WWorkbench/internal/workbenchtools"

	"github.com/mark3labs/mcp-go/server"
	"github.com/wcoreing/ningharness/toolgateway"
)

// DefaultHTTPAddr WWorkbench MCP 默认监听（避开 ningharness 51020 / agentdesk 50423）。
const DefaultHTTPAddr = "127.0.0.1:51021"

// ServerVersion MCP serverInfo.version（与 AppVersion 同源）。
const ServerVersion = buildinfo.Version

// WorkbenchMCPInstructions /mcp/workbench 驾驭说明（前馈；不因未读规则拒绝工具）。
const WorkbenchMCPInstructions = `WWorkbench MCP：工作台能力面（按「AI 能力权限」精简暴露；默认关浏览器/桌面/插件等重域）。
- 【路由协议·首选本 MCP】动手意图（SSH/部署/查生产/改本机或远端配置）：① 先确认本 MCP 工具可用；② **动手前** open_project_stage(localPath=工作区根绝对路径, intent=人话目标)；纯读码/改 UI/讨论方案可跳过；③ 再 get_workbench_context 或 list_ssh_hosts；④ 改机只用 shell_run + get_shell_output。禁止先调 Cursor 自带 Shell/SSH/Terminal。缺工具 → 说「设置→能力权限打开对应域」，禁止说「我改用 Shell」。项目可 ensure_cursor_stage_rule 写入 alwaysApply 规则。
- 【舞台优先·禁止绕开】改本机/远端机器必须用本 MCP（人看得见终端+确认弹窗）。确认弹窗烦也不许绕开。
- 【工具面】tools/list 只含已开启能力。缺工具 → 设置→能力权限打开对应域→保存（MCP 列表热更新）。勿再挂叠 chrome-devtools / browser-use / computer-use 等与本端点重叠的 MCP。
- 【前馈】本段即系统约束摘要；可选 get_agent_rules(domain?) 复核全文。不会因未调用 get_agent_rules 而拒绝工具。open_project_stage / get_workbench_context 含 **learningDigest**（Skill 经验/已信任操作/未收口回合）——动手前先读，禁止空手重探已沉淀路径。
- 【意图】动手类请传 intent（人话：要干什么、影响谁）；缺省时系统会合成「未声明意图」卡片，仍继续执行，确认弹窗与舞台可见。审计：list_mcp_logs 看意图→产品资源(ssh/db/docker/log/http/note/backup/skill)→工具。
- 【项目】**动手对齐** open_project_stage(id|localPath, intent)——无项目则自动建项（拒绝 / 与 $HOME）；再 list/get/save_project；detect_project_git；智能配置 suggest/configure_project_resources；ensure_cursor_stage_rule。纯读码会话不必为对齐而调用。Cursor 跨机：sync/list/get_project_cursor_transcripts（仓库 .wworkbench/cursor-transcripts；非 requestId）。
- 【自学习·Episode】里程碑 suggestedSkill 入队 pendingLessons（不连环 skill_offer）；收口 offer_episode_close → 成长卡勾选 → close_learning_episode 写入项目 Skill。TrustBook=运行时免确认；Skill=可读真源。
- 【鉴权】URL ?token= 或 Authorization Bearer（设置页可复制 mcp.json）；/health 免鉴权。勿用假 token（Cursor 会卡 Authenticating）。
- 【备份】host_health_scan(sshHostId, workDir) → 用户勾选后 ensure_host_backup_policies(findingIds)；或 save_backup_policy → run_backup 无头。禁止全盘扫、禁止默认全选。
- 参数=schema 顶层字段（勿再包 {"arguments":…}）。
- 危险写操作只在确认弹窗拍板（产品标签+账本+命令）。含：SQL/容器/插件/run_backup，以及**远端** shell_run 风险命令。**本机 localShell 非硬风险免确认**（仍可 update_skill / Episode 沉淀）；数据硬风险不可免。远端软文件写：终端右键目录护照可免。确认后：rsync 自动 exclude；写前备份。勿解析 ww_confirm 文本。
- 能解析到 SSH 的操作会先打开/聚焦对应终端 + 状态栏。本机 shell_run 须带 workDir=工作区根（多项目隔离标签；忙碌则新开）。shell_run 返回 updatedAt → 立刻 get_shell_output(waitMs, afterUpdatedAt)。shell_probe=无头只读短探针。断线先 terminal_reconnect。
- 教人信封（全域）：工具失败/里程碑成功可能带 teach、suggestedSkill；经验入 Episode，收口一张成长卡；Agent 须转述 teach，人已点过则勿重复追问。云：get_ecs_monitor / sync_ssh_security_group / configure_ssh_sg_sync。细则 get_agent_rules(domain=cloud|browser|desktop)。
- 容器启停删用 start/stop/remove_container（默认权限关，用时打开），勿用 shell_probe 跑 docker rm。
- 词典：任务=目标；账本=thought+op→log.md；Skill=任意目录 SKILL.md。对外只认 list/get/update/run/distill_skill。闭环：接目标→task_record/browser_*→update_skill。样板 get_skill(wwb-skill-standard)。
- 浏览器/桌面：默认权限关；打开后 browser_* / desktop_*；细则 get_agent_rules(domain=browser|desktop)。
- 笔记本：list_notes / get_note / get_skill；动手前读主机 memory。插件 UI：先 get_plugin_protocol。
- Cursor 只配置本端点 /mcp/workbench（非 /mcp）。`

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
	perms := func() map[string]bool {
		if reg == nil || reg.Deps() == nil {
			return nil
		}
		return reg.Deps().EffectivePermissions()
	}
	wb := server.NewStreamableHTTPServer(
		NewWorkbenchMCPServer(gw, reg, perms),
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
