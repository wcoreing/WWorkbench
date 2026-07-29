package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/httpclient"
	"WWorkbench/internal/model"
)

// ListHTTPRequests 列出已保存 HTTP 请求。
func (s *Service) ListHTTPRequests() ApiResult[[]model.HTTPSavedRequestDO] {
	list, err := s.store.ListHTTPRequests()
	if err != nil {
		return ErrResult[[]model.HTTPSavedRequestDO](err)
	}
	if list == nil {
		list = []model.HTTPSavedRequestDO{}
	}
	return OkResult(list)
}

// SaveHTTPRequest 保存 HTTP 请求模板。
func (s *Service) SaveHTTPRequest(r model.HTTPSavedRequestDO) ApiResult[model.HTTPSavedRequestDO] {
	if strings.TrimSpace(r.Name) == "" {
		return ErrResult[model.HTTPSavedRequestDO](errno.New(errno.CodeInvalidArg, "请填写请求名称", ""))
	}
	if strings.TrimSpace(r.URL) == "" {
		return ErrResult[model.HTTPSavedRequestDO](errno.New(errno.CodeInvalidArg, "请填写请求 URL", ""))
	}
	if r.Method == "" {
		r.Method = "GET"
	}
	if r.ParamsJSON == "" {
		r.ParamsJSON = "[]"
	}
	if r.HeadersJSON == "" {
		r.HeadersJSON = "[]"
	}
	if r.CookiesJSON == "" {
		r.CookiesJSON = "[]"
	}
	saved, err := s.store.SaveHTTPRequest(r)
	if err != nil {
		return ErrResult[model.HTTPSavedRequestDO](err)
	}
	return OkResult(saved)
}

// MoveHTTPRequestToFolder 将接口移入目录（folderID 为空表示根目录）。
func (s *Service) MoveHTTPRequestToFolder(id, folderID string) ApiResult[bool] {
	if strings.TrimSpace(id) == "" {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "缺少接口 ID", ""))
	}
	if err := s.store.MoveHTTPRequestToFolder(id, folderID); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// DeleteHTTPRequest 删除 HTTP 请求模板。
func (s *Service) DeleteHTTPRequest(id string) ApiResult[bool] {
	if err := s.store.DeleteHTTPRequest(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ExecuteHTTPRequest 发送 HTTP 请求。
func (s *Service) ExecuteHTTPRequest(req model.HTTPExecuteRequestDO) ApiResult[model.HTTPResponseDO] {
	req = s.applyEnvToHTTPRequest(req)
	if strings.TrimSpace(req.URL) == "" {
		return ErrResult[model.HTTPResponseDO](errno.New(errno.CodeInvalidArg, "请填写请求 URL", ""))
	}
	resp, err := httpclient.Execute(req)
	if err != nil {
		return ErrResult[model.HTTPResponseDO](err)
	}
	return OkResult(*resp)
}
