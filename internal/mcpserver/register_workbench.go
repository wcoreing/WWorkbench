package mcpserver

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/workbenchtools"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/wcoreing/ningharness/toolgateway"
)

// NewWorkbenchMCPServer 仅注册工作台产品工具（不含 ningharness 核工具）。
// perms 非空时只把已启用工具挂到 tools/list，从源头缩短 Cursor 工具面。
func NewWorkbenchMCPServer(gw *toolgateway.Gateway, reg *workbenchtools.Registry, perms func() map[string]bool) *server.MCPServer {
	opts := []server.ServerOption{server.WithToolCapabilities(true)}
	opts = append(opts, server.WithInstructions(WorkbenchMCPInstructions))
	s := server.NewMCPServer("wworkbench-workbench", ServerVersion, opts...)
	registerWorkbenchTools(s, gw, reg, perms)
	return s
}

func registerWorkbenchTools(s *server.MCPServer, gw *toolgateway.Gateway, reg *workbenchtools.Registry, perms func() map[string]bool) {
	if s == nil || reg == nil {
		return
	}
	enabled := map[string]bool(nil)
	if perms != nil {
		enabled = perms()
	}
	for _, def := range reg.ListMCPDefs() {
		name := strings.TrimSpace(def.Name)
		if name == "" || name == "recall_resource" {
			continue
		}
		if enabled != nil && !workbenchtools.IsToolEnabled(enabled, name) {
			continue
		}
		schema, err := json.Marshal(def.Parameters)
		if err != nil || len(schema) == 0 {
			schema = []byte(`{"type":"object","properties":{}}`)
		}
		tool := mcp.NewToolWithRawSchema(name, def.Description, schema)
		toolName := name
		if fn := gwHandler(gw, toolName); fn != nil {
			handler := fn
			s.AddTool(tool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				return handler(ctx, req)
			})
			continue
		}
		if def.MCPOnly {
			s.AddTool(tool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				return invokeRegistryTool(ctx, reg, toolName, req)
			})
		}
	}
}

func gwHandler(gw *toolgateway.Gateway, name string) toolgateway.ToolHandler {
	if gw == nil {
		return nil
	}
	return gw.Handler(name)
}

func invokeRegistryTool(ctx context.Context, reg *workbenchtools.Registry, name string, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ctx = workbenchtools.WithCaller(ctx, workbenchtools.CallerMCP)
	args := req.GetArguments()
	raw, err := json.Marshal(args)
	if err != nil {
		raw = []byte("{}")
	}
	var enabled map[string]bool
	if reg != nil && reg.Deps() != nil {
		enabled = reg.Deps().EffectivePermissions()
	}
	res := reg.Invoke(ctx, name, raw, enabled)
	if res.NeedsConfirm {
		res = workbenchtools.AwaitConfirmAndExecute(ctx, reg.Deps(), name, raw, res)
	}
	if res.NeedsChoice {
		wire, _ := json.Marshal(map[string]any{
			"ww_choice": true,
			"summary":   res.ConfirmSummary,
			"preview":   json.RawMessage(res.Data),
		})
		return mcp.NewToolResultText(string(wire)), nil
	}
	if !res.OK {
		return mcp.NewToolResultError(res.Error), nil
	}
	if len(res.Data) > 0 {
		return mcp.NewToolResultText(string(res.Data)), nil
	}
	return mcp.NewToolResultText(`{"ok":true}`), nil
}
