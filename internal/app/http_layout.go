package app

import (
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// ApplyHTTPApiTreeLayout 保存 HTTP 侧栏树布局（拖拽移动目录/接口与排序）。
func (s *Service) ApplyHTTPApiTreeLayout(layout model.HTTPApiTreeLayoutDO) ApiResult[bool] {
	if len(layout.ChildrenByParent) == 0 {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "布局不能为空", ""))
	}
	if err := s.store.ApplyHTTPApiTreeLayout(layout); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
