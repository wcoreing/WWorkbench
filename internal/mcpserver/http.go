package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"WWorkbench/internal/workbenchtools"

	"github.com/mark3labs/mcp-go/server"
	"github.com/wcoreing/ningharness/toolgateway"
)

// DefaultHTTPAddr WWorkbench MCP 默认监听（避开 ningharness 51020 / agentdesk 50423）。
const DefaultHTTPAddr = "127.0.0.1:51021"

// ServerVersion MCP serverInfo.version（与 AppVersion 同步递增）。
const ServerVersion = "0.54.159"

// WorkbenchMCPInstructions /mcp/workbench 驾驭说明。
const WorkbenchMCPInstructions = `WWorkbench MCP：工作台能力面（数据库 / 终端 / Docker / HTTP / 日志 / 笔记本等）。
- 参数=schema 顶层字段（勿再包 {"arguments":…}）。
- 写操作可能返回含 ww_confirm 的文本；需在 WWorkbench 侧栏确认，外置客户端本期不弹确认框。
- 容器启停/删除用 start_container / stop_container / remove_container，勿用 shell_probe 跑 docker rm/start/stop。
- 问终端输出用 get_shell_output（分页读可见 PTY scrollback；offsetFromEnd=0 最新页，nextOffsetFromEnd 向历史翻）。shell_run=给人看（注入 pip/下载/训练/脚本，不返回 stdout）。shell_probe=无头只读短探针，禁止改机器；看磁盘文件用 cat，不要 sed/awk。
- HTTP：先 save_http_request / save_http_environment，再 execute_http(requestId / envId)。
- 笔记本：list_notes / search_notes / get_note(noteId) 读正文；notebook_append_content 写入；首次发布技能 publish_agent_skill；改已有技能 update_agent_skill（不写笔记）；抽象为方法包 /skill-to-method-pack。
- Agent 对话：agent_chat 同步发消息并等回复（支持 /skill-id、mentions、sshHostId）；待确认用 agent_confirm。
- SSH / 数据库 / 日志 / Docker：save_ssh_host、save_ssh_forward、save_connection、save_log_source、save_docker_context 落盘后再引用 ID。
- 工具受「AI 能力权限」开关约束；关闭的能力会拒绝调用。
- Cursor 请配置本端点 /mcp/workbench（非 /mcp）。`

// HTTPService 包装 ningharness MCP HTTP，并暴露 workbench URL。
type HTTPService struct {
	*toolgateway.HTTPService
}

// WorkbenchEndpointURL 产品工具面 URL。
func (s *HTTPService) WorkbenchEndpointURL() string {
	if s == nil || s.HTTPService == nil {
		return ""
	}
	return strings.TrimSuffix(s.EndpointURL(), "/mcp") + "/mcp/workbench"
}

// StartHTTP 启动 MCP HTTP：/mcp 核工具 + /mcp/workbench 工作台工具。
func StartHTTP(addr string, gw *toolgateway.Gateway, reg *workbenchtools.Registry) (*HTTPService, error) {
	if gw == nil {
		return nil, fmt.Errorf("nil gateway")
	}
	if reg == nil {
		return nil, fmt.Errorf("nil registry")
	}
	addr = strings.TrimSpace(addr)
	if addr == "" {
		addr = strings.TrimSpace(os.Getenv("WWORKBENCH_MCP_ADDR"))
	}
	if addr == "" {
		addr = DefaultHTTPAddr
	}
	base, err := toolgateway.StartHTTP(toolgateway.HTTPConfig{
		Addr:         addr,
		ServerName:   "wworkbench",
		Version:      ServerVersion,
		Instructions: "ningharness core tools hosted by WWorkbench",
		HealthName:   "wworkbench",
		ExtraRoutes: func(mux *http.ServeMux, _ *toolgateway.Gateway) {
			wbHTTP := server.NewStreamableHTTPServer(
				NewWorkbenchMCPServer(gw, reg),
				server.WithEndpointPath("/mcp/workbench"),
			)
			mux.Handle("/mcp/workbench", workbenchHTTPCORS(wbHTTP))
		},
	}, gw)
	if err != nil {
		return nil, err
	}
	return &HTTPService{HTTPService: base}, nil
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

// Stop 关闭 MCP HTTP。
func (s *HTTPService) Stop(ctx context.Context) error {
	if s == nil || s.HTTPService == nil {
		return nil
	}
	return s.HTTPService.Stop(ctx)
}
