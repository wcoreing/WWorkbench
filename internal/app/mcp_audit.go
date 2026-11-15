package app

import (
	"strings"

	"WWorkbench/internal/model"
)

// ListMCPCallLogs 列出 MCP/工具调用审计（意图→产品资源→工具）。
func (s *Service) ListMCPCallLogs(filter model.MCPCallLogFilter) ApiResult[[]model.MCPCallLogDO] {
	list, err := s.store.ListMCPCallLogs(filter)
	if err != nil {
		return ErrResult[[]model.MCPCallLogDO](err)
	}
	if list == nil {
		list = []model.MCPCallLogDO{}
	}
	return OkResult(list)
}

// GetMCPCallLog 取一条 MCP 调用详情。
func (s *Service) GetMCPCallLog(id string) ApiResult[model.MCPCallLogDO] {
	row, err := s.store.GetMCPCallLog(strings.TrimSpace(id))
	if err != nil {
		return ErrResult[model.MCPCallLogDO](err)
	}
	return OkResult(row)
}
