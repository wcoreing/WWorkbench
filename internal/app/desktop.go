package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbenchtools"
)

// ListDesktopAppGrants 列出允许 AI 读取 / 操作的桌面应用。
func (s *Service) ListDesktopAppGrants() ApiResult[[]model.DesktopAppGrantDO] {
	book := s.desktopGrantBook()
	out := []model.DesktopAppGrantDO{}
	if book == nil {
		return OkResult(out)
	}
	for _, it := range book.List() {
		out = append(out, model.DesktopAppGrantDO{Key: it.Key, Name: it.Name, Level: it.Level, At: it.At})
	}
	return OkResult(out)
}

// RevokeDesktopAppGrant 撤销某个桌面应用的 AI 授权；下次读取 / 操作会重新弹窗询问。
func (s *Service) RevokeDesktopAppGrant(key string) ApiResult[int] {
	book := s.desktopGrantBook()
	if book == nil {
		return ErrResult[int](errno.New(errno.CodeUnknown, "授权簿未就绪", ""))
	}
	return OkResult(book.Revoke(strings.TrimSpace(key)))
}

func (s *Service) desktopGrantBook() *workbenchtools.DesktopGrantBook {
	if s.toolsRegistry == nil || s.toolsRegistry.Deps() == nil {
		return nil
	}
	return s.toolsRegistry.Deps().DesktopGrants
}
