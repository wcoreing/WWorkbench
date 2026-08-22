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
func NewWorkbenchMCPServer(gw *toolgateway.Gateway, reg *workbenchtools.Registry) *server.MCPServer {
	opts := []server.ServerOption{server.WithToolCapabilities(true)}
	opts = append(opts, server.WithInstructions(WorkbenchMCPInstructions))
	s := server.NewMCPServer("wworkbench-workbench", ServerVersion, opts...)
	registerWorkbenchTools(s, gw, reg)
	return s
}

func registerWorkbenchTools(s *server.MCPServer, gw *toolgateway.Gateway, reg *workbenchtools.Registry) {
	if s == nil || reg == nil {
		return
	}
	for _, def := range reg.ListMCPDefs() {
		name := strings.TrimSpace(def.Name)
		if name == "" || name == "recall_resource" {
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
	args := req.GetArguments()
	raw, err := json.Marshal(args)
	if err != nil {
		raw = []byte("{}")
	}
	res := reg.Invoke(ctx, name, raw, nil)
	if res.NeedsConfirm {
		wire, _ := json.Marshal(map[string]any{
			"ww_confirm": true,
			"summary":    res.ConfirmSummary,
			"preview":    json.RawMessage(res.Data),
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
