package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// ListHTTPFolders 列出 HTTP 接口目录。
func (s *Service) ListHTTPFolders() ApiResult[[]model.HTTPFolderDO] {
	list, err := s.store.ListHTTPFolders()
	if err != nil {
		return ErrResult[[]model.HTTPFolderDO](err)
	}
	if list == nil {
		list = []model.HTTPFolderDO{}
	}
	return OkResult(list)
}

// SaveHTTPFolder 保存 HTTP 接口目录。
func (s *Service) SaveHTTPFolder(f model.HTTPFolderDO) ApiResult[model.HTTPFolderDO] {
	if strings.TrimSpace(f.Name) == "" {
		return ErrResult[model.HTTPFolderDO](errno.New(errno.CodeInvalidArg, "请填写目录名称", ""))
	}
	saved, err := s.store.SaveHTTPFolder(f)
	if err != nil {
		return ErrResult[model.HTTPFolderDO](err)
	}
	return OkResult(saved)
}

// DeleteHTTPFolder 删除目录、其子目录及目录内全部接口。
func (s *Service) DeleteHTTPFolder(id string) ApiResult[bool] {
	return s.DeleteHTTPFolders([]string{id})
}

// DeleteHTTPFolders 批量删除目录（含子目录及目录内接口）。
func (s *Service) DeleteHTTPFolders(ids []string) ApiResult[bool] {
	return s.BatchDeleteHTTP(ids, nil)
}

// BatchDeleteHTTP 批量删除勾选的目录与接口。
func (s *Service) BatchDeleteHTTP(folderIDs, requestIDs []string) ApiResult[bool] {
	if len(folderIDs) == 0 && len(requestIDs) == 0 {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "请选择要删除的目录或接口", ""))
	}
	if err := s.store.BatchDeleteHTTP(folderIDs, requestIDs); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
