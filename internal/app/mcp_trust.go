package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbenchtools"
)

// ListMCPTrustOps 列出 MCP 信任操作账本。
func (s *Service) ListMCPTrustOps() ApiResult[[]model.MCPTrustOpDO] {
	book := s.trustOpBook()
	if book == nil {
		return OkResult([]model.MCPTrustOpDO{})
	}
	items := book.List()
	out := make([]model.MCPTrustOpDO, 0, len(items))
	for _, it := range items {
		out = append(out, model.MCPTrustOpDO{
			Tool:        it.Tool,
			HostKey:     it.HostKey,
			Fingerprint: it.Fingerprint,
			Intent:      it.Intent,
			Command:     it.Command,
			Risk:        it.Risk,
			ProjectID:   it.ProjectID,
			SkillPath:   it.SkillPath,
			Summary:     it.Summary,
			At:          it.At,
		})
	}
	return OkResult(out)
}

// RevokeMCPTrustOp 按指纹撤销信任；撤销后同类操作恢复确认弹窗。
func (s *Service) RevokeMCPTrustOp(fingerprint string) ApiResult[bool] {
	book := s.trustOpBook()
	if book == nil {
		return ErrResult[bool](errno.New(errno.CodeUnknown, "信任账本未就绪", ""))
	}
	ok := book.Revoke(strings.TrimSpace(fingerprint))
	if !ok {
		return ErrResult[bool](errno.New(errno.CodeNotFound, "未找到该信任条目", fingerprint))
	}
	return OkResult(true)
}

func (s *Service) trustOpBook() *workbenchtools.MCPTrustBook {
	if s.toolsRegistry == nil || s.toolsRegistry.Deps() == nil {
		return nil
	}
	return s.toolsRegistry.Deps().TrustOps
}
