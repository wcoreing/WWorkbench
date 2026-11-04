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
const ServerVersion = "0.54.330"

// WorkbenchMCPInstructions /mcp/workbench 驾驭说明。
const WorkbenchMCPInstructions = `WWorkbench MCP：工作台能力面（数据库 / 终端 / Docker / HTTP / 日志 / 笔记本等）。
- 参数=schema 顶层字段（勿再包 {"arguments":…}）。
- 危险写操作在工作台弹窗拍板（工具会阻塞至用户确认/拒绝；确认和看过程同一视线）。含：SQL/容器/插件，以及 shell_run 风险命令（重定向写文件、rm、docker rm/stop、| sh 等）。勿再解析 ww_confirm 文本。
- 凡参数能解析到 SSH（hostId / sshHostId / hostOrName / 远端 Docker contextId / SSH 日志源 / SSH 隧道库连接）的操作，都会先打开并聚焦对应终端 + 状态栏，再执行。shell_run 注入后立刻 get_shell_output(waitMs=8000～30000[, afterUpdatedAt]) 等新输出，少空转轮询。
- 容器启停/删除用 start_container / stop_container / remove_container，勿用 shell_probe 跑 docker rm/start/stop。
- 问终端输出用 get_shell_output（分页读可见 PTY scrollback；offsetFromEnd=0 最新页，nextOffsetFromEnd 向历史翻）。shell_run=给人看（注入 pip/下载/训练/脚本，不返回 stdout）。shell_probe=无头只读短探针，禁止改机器；看磁盘文件用 cat，不要 sed/awk。
- 终端断开或出现「会话已结束」时先 terminal_reconnect（sessionId 或 hostId），再 shell_run / get_shell_output。
- HTTP：先 save_http_request / save_http_environment，再 execute_http(requestId / envId)。
- 笔记本：list_notes / search_notes / get_note(noteId) 读正文；notebook_append_content 写入；首次发布技能 publish_agent_skill；改已有技能 update_agent_skill（不写笔记）；抽象为方法包 /skill-to-method-pack。
- 插件包（改「数据库插件」UI / Host 桥接，不是连库、不是 skill）：先 get_plugin_protocol（平台 PROTOCOL.md）；再改 src/ui；局部改 edit_plugin_pack_file；构建 build_plugin_pack_ui。禁止 list_skills 找 bridge。
- Agent 对话：agent_chat 同步发消息并等回复（支持 /skill-id、mentions、sshHostId）；待确认用 agent_confirm。
- SSH / 数据库 / 日志 / Docker：save_ssh_host、save_ssh_forward、save_connection、save_log_source、save_docker_context 落盘后再引用 ID。
- 工具受「AI 能力权限」开关约束；关闭的能力会拒绝调用。
- Cursor 请配置本端点 /mcp/workbench（非 /mcp）。`

// NewHandler 组装 /mcp、/mcp/workbench、/health。不监听端口。
// 两端都无状态：Cursor 空闲挂起后带着旧 session 再调，不会因会话失效被 404。
func NewHandler(gw *toolgateway.Gateway, reg *workbenchtools.Registry) (http.Handler, error) {
	if gw == nil {
		return nil, fmt.Errorf("nil gateway")
	}
	if reg == nil {
		return nil, fmt.Errorf("nil registry")
	}
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
	mux.Handle("/mcp", workbenchHTTPCORS(core))
	mux.Handle("/mcp/workbench", workbenchHTTPCORS(wb))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"ready":true,"name":"wworkbench","mcp":"/mcp"}`))
	})
	return mux, nil
}

func workbenchHTTPCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
