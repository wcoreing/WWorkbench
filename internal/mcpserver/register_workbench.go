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
	if s == nil || gw == nil || reg == nil {
		return
	}
	for _, def := range reg.ListDefs() {
		name := strings.TrimSpace(def.Name)
		if name == "" || name == "recall_resource" {
			continue
		}
		fn := gw.Handler(name)
		if fn == nil {
			continue
		}
		schema, err := json.Marshal(def.Parameters)
		if err != nil || len(schema) == 0 {
			schema = []byte(`{"type":"object","properties":{}}`)
		}
		tool := mcp.NewToolWithRawSchema(name, def.Description, schema)
		handler := fn
		s.AddTool(tool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return handler(ctx, req)
		})
	}
}
