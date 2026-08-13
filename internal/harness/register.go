package harness

import (
	"context"
	"encoding/json"

	"WWorkbench/internal/workbenchtools"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/wcoreing/ningharness/toolgateway"
)

// RegisterWorkbenchTools 将产品工具挂到 ningharness Gateway（副作用统一入口）。
func RegisterWorkbenchTools(gw *toolgateway.Gateway, reg *workbenchtools.Registry, perms func() map[string]bool) {
	if gw == nil || reg == nil {
		return
	}
	for _, def := range reg.ListDefs() {
		name := def.Name
		if name == "recall_resource" {
			continue // 召回由 ningharness 核工具负责
		}
		toolName := name
		gw.RegisterHandler(toolName, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args := req.GetArguments()
			raw, err := json.Marshal(args)
			if err != nil {
				raw = []byte("{}")
			}
			var enabled map[string]bool
			if perms != nil {
				enabled = perms()
			}
			res := reg.Invoke(ctx, toolName, raw, enabled)
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
		})
	}
}
