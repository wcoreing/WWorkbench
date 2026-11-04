package app

import "WWorkbench/internal/errno"

// ResolveMCPConfirm 外置 MCP 危险操作在工作台拍板（配合 mcp:confirm 事件）。
func (s *Service) ResolveMCPConfirm(pendingID string, approved bool) ApiResult[bool] {
	if s.toolsRegistry == nil || s.toolsRegistry.Deps() == nil || s.toolsRegistry.Deps().MCPConfirm == nil {
		return ErrResult[bool](errno.New(errno.CodeUnknown, "确认门未就绪", ""))
	}
	ok := s.toolsRegistry.Deps().MCPConfirm.Resolve(pendingID, approved)
	if !ok {
		return ErrResult[bool](errno.New(errno.CodeNotFound, "没有对应的待确认请求（可能已超时）", pendingID))
	}
	return OkResult(true)
}
